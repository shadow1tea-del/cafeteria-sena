
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const { Pool } = require('pg');
const dns = require('node:dns');
dns.setDefaultResultOrder('ipv4first');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const app = express();

app.use(cors());
app.use(express.json());

const dbLocal = mysql.createPool({
  host: process.env.LOCAL_DB_HOST,
  port: Number(process.env.LOCAL_DB_PORT),
  user: process.env.LOCAL_DB_USER,
  password: process.env.LOCAL_DB_PASSWORD,
  database: process.env.LOCAL_DB_NAME,
  waitForConnections: true,
  connectionLimit: 5
});

const dbAzure = mysql.createPool({
  host: process.env.AZURE_DB_HOST,
  port: Number(process.env.AZURE_DB_PORT || 3306),
  user: process.env.AZURE_DB_USER,
  password: process.env.AZURE_DB_PASSWORD,
  database: process.env.AZURE_DB_NAME,
  ssl: { minVersion: 'TLSv1.2' },
  waitForConnections: true,
  connectionLimit: 5,
  connectTimeout: 10000
});

const dbSupabase = new Pool({
  host: process.env.SUPABASE_DB_HOST,
  port: Number(process.env.SUPABASE_DB_PORT),
  user: process.env.SUPABASE_DB_USER,
  password: process.env.SUPABASE_DB_PASSWORD,
  database: process.env.SUPABASE_DB_NAME,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 10000
});

const dbAWS = mysql.createPool({
  host: process.env.AWS_DB_HOST,
  port: Number(process.env.AWS_DB_PORT || 3306),
  user: process.env.AWS_DB_USER,
  password: process.env.AWS_DB_PASSWORD,
  database: process.env.AWS_DB_NAME,
  ssl: {
    ca: fs.readFileSync(path.join(__dirname, 'certs/global-bundle.pem')),
    minVersion: 'TLSv1.2'
  },
  waitForConnections: true,
  connectionLimit: 5,
  connectTimeout: 10000
});

const JOURNAL_TABLE = 'cafeteria_sync_log';

let syncInProgress = false;

async function comprobar(pool) {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

async function prepararBitacora(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${JOURNAL_TABLE} (
      op_id CHAR(36) NOT NULL PRIMARY KEY,
      entidad VARCHAR(40) NOT NULL,
      accion VARCHAR(20) NOT NULL,
      registro_id INT NOT NULL,
      datos LONGTEXT,
      creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      sincronizado TINYINT(1) NOT NULL DEFAULT 0,
      INDEX idx_sync_pendiente (sincronizado, creado_en)
    ) ENGINE=InnoDB
  `);
}

async function aplicarCambio(pool, cambio) {
  const datos = typeof cambio.datos === 'string'
    ? JSON.parse(cambio.datos)
    : cambio.datos;

  if (cambio.entidad === 'aprendiz') {
    if (cambio.accion === 'eliminar') {
      await pool.query(
        'DELETE FROM tbl_aprendices_clientes WHERE id_aprendiz = ?',
        [cambio.registro_id]
      );
      return;
    }

    await pool.query(`
      INSERT INTO tbl_aprendices_clientes
        (id_aprendiz, nombres, documento, programa_formacion, saldo_tarjeta)
      VALUES (?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        nombres = VALUES(nombres),
        documento = VALUES(documento),
        programa_formacion = VALUES(programa_formacion),
        saldo_tarjeta = VALUES(saldo_tarjeta)
    `, [
      datos.id_aprendiz,
      datos.nombres,
      datos.documento,
      datos.programa_formacion,
      datos.saldo_tarjeta
    ]);
    return;
  }

  if (cambio.entidad === 'empleado') {
    if (cambio.accion === 'eliminar') {
      await pool.query(
        'DELETE FROM tbl_empleados WHERE id_empleado = ?',
        [cambio.registro_id]
      );
      return;
    }

    await pool.query(`
      INSERT INTO tbl_empleados
        (id_empleado, nombre, turno, rol)
      VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        nombre = VALUES(nombre),
        turno = VALUES(turno),
        rol = VALUES(rol)
    `, [
      datos.id_empleado,
      datos.nombre,
      datos.turno,
      datos.rol
    ]);
    return;
  }

  throw new Error('Entidad de sincronización no reconocida.');
}

async function sincronizarPendientes(origen, destino) {
  const [pendientes] = await origen.query(`
    SELECT op_id, entidad, accion, registro_id, datos
    FROM ${JOURNAL_TABLE}
    WHERE sincronizado = 0
    ORDER BY creado_en ASC
  `);

  for (const cambio of pendientes) {
    // Evita aplicar dos veces la misma operación.
    const [existente] = await destino.query(
      `SELECT op_id FROM ${JOURNAL_TABLE} WHERE op_id = ?`,
      [cambio.op_id]
    );

    if (existente.length === 0) {
      await aplicarCambio(destino, cambio);

      await destino.query(`
        INSERT IGNORE INTO ${JOURNAL_TABLE}
          (op_id, entidad, accion, registro_id, datos, sincronizado)
        VALUES (?, ?, ?, ?, ?, 1)
      `, [
        cambio.op_id,
        cambio.entidad,
        cambio.accion,
        cambio.registro_id,
        cambio.datos
      ]);
    }

    await origen.query(
      `UPDATE ${JOURNAL_TABLE} SET sincronizado = 1 WHERE op_id = ?`,
      [cambio.op_id]
    );
  }

  return pendientes.length;
}

async function obtenerBaseActiva() {
  const [azureDisponible, awsDisponible] = await Promise.all([
    comprobar(dbAzure),
    comprobar(dbAWS)
  ]);

  if (!azureDisponible && !awsDisponible) {
    throw new Error('Azure y Amazon están desconectados.');
  }

  if (azureDisponible) {
    // Azure siempre vuelve a ser la principal.
    if (awsDisponible && !syncInProgress) {
      syncInProgress = true;
      try {
        await prepararBitacora(dbAzure);
        await prepararBitacora(dbAWS);

        // Primero se recuperan los cambios hechos durante la caída
        // de Azure. Después se envían los pendientes de Azure a Amazon.
        await sincronizarPendientes(dbAWS, dbAzure);
        await sincronizarPendientes(dbAzure, dbAWS);
      } catch (error) {
        console.error('Sincronización pendiente:', error.message);
      } finally {
        syncInProgress = false;
      }
    }

    await prepararBitacora(dbAzure);
    return { db: dbAzure, nombre: 'Azure' };
  }

  await prepararBitacora(dbAWS);
  return { db: dbAWS, nombre: 'Amazon' };
}

async function guardarOperacion(entidad, accion, registroId, datos) {
  const { db, nombre } = await obtenerBaseActiva();
  const opId = randomUUID();

  const conexion = await db.getConnection();

  try {
    await conexion.beginTransaction();

    const cambio = {
      entidad,
      accion,
      registro_id: registroId,
      datos
    };

    await aplicarCambio({
      query: (...args) => conexion.query(...args)
    }, cambio);

    await conexion.query(`
      INSERT INTO ${JOURNAL_TABLE}
        (op_id, entidad, accion, registro_id, datos, sincronizado)
      VALUES (?, ?, ?, ?, ?, 0)
    `, [
      opId,
      entidad,
      accion,
      registroId,
      JSON.stringify(datos)
    ]);

    await conexion.commit();

    return { baseActiva: nombre, operacion: opId };
  } catch (error) {
    await conexion.rollback();
    throw error;
  } finally {
    conexion.release();
  }
}

function validarId(id) {
  const numero = Number(id);
  if (!Number.isInteger(numero) || numero <= 0) {
    throw new Error('El identificador no es válido.');
  }
  return numero;
}

// Ruta principal
app.get('/', (req, res) => {
  res.json({
    mensaje: 'API de Cafetería SENA funcionando',
    endpoints: [
      '/api/pos-local',
      '/api/clientes-azure',
      '/api/alertas-supabase',
      '/api/aprendices',
      '/api/empleados',
      '/api/estado-bases-datos'
    ]
  });
});

// MariaDB local: productos y ventas
app.get('/api/pos-local', async (req, res) => {
  try {
    const [productos] = await dbLocal.query(
      'SELECT * FROM tbl_productos_local'
    );
    const [ventas] = await dbLocal.query(
      'SELECT * FROM tbl_ventas_diarias'
    );
    res.json({ productos, ventas });
  } catch (error) {
    console.error('Error MariaDB:', error.message);
    res.status(500).json({
      error: 'No se pudieron consultar productos y ventas locales.'
    });
  }
});

// Consulta con selección automática Azure/Amazon
app.get('/api/clientes-azure', async (req, res) => {
  try {
    const { db, nombre } = await obtenerBaseActiva();

    const [clientes] = await db.query(
      'SELECT * FROM tbl_aprendices_clientes ORDER BY id_aprendiz'
    );
    const [empleados] = await db.query(
      'SELECT * FROM tbl_empleados ORDER BY id_empleado'
    );

    res.json({ clientes, empleados, baseActiva: nombre });
  } catch (error) {
    console.error('Error consultando aprendices y empleados:', error.message);
    res.status(503).json({ error: error.message });
  }
});

// Obtener aprendices
app.get('/api/aprendices', async (req, res) => {
  try {
    const { db, nombre } = await obtenerBaseActiva();
    const [filas] = await db.query(
      'SELECT * FROM tbl_aprendices_clientes ORDER BY id_aprendiz'
    );
    res.json({ datos: filas, baseActiva: nombre });
  } catch (error) {
    res.status(503).json({ error: error.message });
  }
});

// Crear aprendiz
app.post('/api/aprendices', async (req, res) => {
  try {
    const { nombres, documento, programa_formacion, saldo_tarjeta = 0 } = req.body;

    if (!nombres || !documento || !programa_formacion) {
      return res.status(400).json({
        error: 'Nombres, documento y programa de formación son obligatorios.'
      });
    }

    const { db } = await obtenerBaseActiva();
    const [resultado] = await db.query(
      `SELECT COALESCE(MAX(id_aprendiz), 0) + 1 AS nuevo_id
       FROM tbl_aprendices_clientes`
    );

    const id = Number(resultado[0].nuevo_id);

    const datos = {
      id_aprendiz: id,
      nombres: String(nombres).trim(),
      documento: String(documento).trim(),
      programa_formacion: String(programa_formacion).trim(),
      saldo_tarjeta: Number(saldo_tarjeta)
    };

    const guardado = await guardarOperacion('aprendiz', 'crear', id, datos);
    res.status(201).json({ mensaje: 'Aprendiz registrado.', ...guardado, datos });
  } catch (error) {
    console.error('Error creando aprendiz:', error.message);
    res.status(400).json({ error: error.message });
  }
});

// Actualizar aprendiz
app.put('/api/aprendices/:id', async (req, res) => {
  try {
    const id = validarId(req.params.id);
    const { nombres, documento, programa_formacion, saldo_tarjeta } = req.body;

    if (!nombres || !documento || !programa_formacion ||
        saldo_tarjeta === undefined) {
      return res.status(400).json({
        error: 'Debes enviar todos los campos del aprendiz.'
      });
    }

    const datos = {
      id_aprendiz: id,
      nombres: String(nombres).trim(),
      documento: String(documento).trim(),
      programa_formacion: String(programa_formacion).trim(),
      saldo_tarjeta: Number(saldo_tarjeta)
    };

    const { db } = await obtenerBaseActiva();
    const [actual] = await db.query(
      'SELECT id_aprendiz FROM tbl_aprendices_clientes WHERE id_aprendiz = ?',
      [id]
    );

    if (!actual.length) {
      return res.status(404).json({ error: 'Aprendiz no encontrado.' });
    }

    const guardado = await guardarOperacion('aprendiz', 'actualizar', id, datos);
    res.json({ mensaje: 'Aprendiz actualizado.', ...guardado });
  } catch (error) {
    console.error('Error actualizando aprendiz:', error.message);
    res.status(400).json({ error: error.message });
  }
});

// Eliminar aprendiz
app.delete('/api/aprendices/:id', async (req, res) => {
  try {
    const id = validarId(req.params.id);
    const { db } = await obtenerBaseActiva();

    const [actual] = await db.query(
      'SELECT id_aprendiz FROM tbl_aprendices_clientes WHERE id_aprendiz = ?',
      [id]
    );

    if (!actual.length) {
      return res.status(404).json({ error: 'Aprendiz no encontrado.' });
    }

    const guardado = await guardarOperacion('aprendiz', 'eliminar', id, null);
    res.json({ mensaje: 'Aprendiz eliminado.', ...guardado });
  } catch (error) {
    console.error('Error eliminando aprendiz:', error.message);
    res.status(400).json({ error: error.message });
  }
});

// Obtener empleados
app.get('/api/empleados', async (req, res) => {
  try {
    const { db, nombre } = await obtenerBaseActiva();
    const [filas] = await db.query(
      'SELECT * FROM tbl_empleados ORDER BY id_empleado'
    );
    res.json({ datos: filas, baseActiva: nombre });
  } catch (error) {
    res.status(503).json({ error: error.message });
  }
});

// Crear empleado
app.post('/api/empleados', async (req, res) => {
  try {
    const { nombre, turno, rol } = req.body;

    if (!nombre || !turno || !rol) {
      return res.status(400).json({
        error: 'Nombre, turno y rol son obligatorios.'
      });
    }

    const { db } = await obtenerBaseActiva();
    const [resultado] = await db.query(
      'SELECT COALESCE(MAX(id_empleado), 0) + 1 AS nuevo_id FROM tbl_empleados'
    );

    const id = Number(resultado[0].nuevo_id);
    const datos = {
      id_empleado: id,
      nombre: String(nombre).trim(),
      turno: String(turno).trim(),
      rol: String(rol).trim()
    };

    const guardado = await guardarOperacion('empleado', 'crear', id, datos);
    res.status(201).json({ mensaje: 'Empleado registrado.', ...guardado, datos });
  } catch (error) {
    console.error('Error creando empleado:', error.message);
    res.status(400).json({ error: error.message });
  }
});

// Actualizar empleado
app.put('/api/empleados/:id', async (req, res) => {
  try {
    const id = validarId(req.params.id);
    const { nombre, turno, rol } = req.body;

    if (!nombre || !turno || !rol) {
      return res.status(400).json({
        error: 'Nombre, turno y rol son obligatorios.'
      });
    }

    const datos = {
      id_empleado: id,
      nombre: String(nombre).trim(),
      turno: String(turno).trim(),
      rol: String(rol).trim()
    };

    const { db } = await obtenerBaseActiva();
    const [actual] = await db.query(
      'SELECT id_empleado FROM tbl_empleados WHERE id_empleado = ?',
      [id]
    );

    if (!actual.length) {
      return res.status(404).json({ error: 'Empleado no encontrado.' });
    }

    const guardado = await guardarOperacion('empleado', 'actualizar', id, datos);
    res.json({ mensaje: 'Empleado actualizado.', ...guardado });
  } catch (error) {
    console.error('Error actualizando empleado:', error.message);
    res.status(400).json({ error: error.message });
  }
});

// Eliminar empleado
app.delete('/api/empleados/:id', async (req, res) => {
  try {
    const id = validarId(req.params.id);
    const { db } = await obtenerBaseActiva();

    const [actual] = await db.query(
      'SELECT id_empleado FROM tbl_empleados WHERE id_empleado = ?',
      [id]
    );

    if (!actual.length) {
      return res.status(404).json({ error: 'Empleado no encontrado.' });
    }

    const guardado = await guardarOperacion('empleado', 'eliminar', id, null);
    res.json({ mensaje: 'Empleado eliminado.', ...guardado });
  } catch (error) {
    console.error('Error eliminando empleado:', error.message);
    res.status(400).json({ error: error.message });
  }
});

// Supabase: alertas y PQR
app.get('/api/alertas-supabase', async (req, res) => {
  try {
    const alertas = await dbSupabase.query(
      'SELECT * FROM public.tbl_alertas_inventario ORDER BY creado_en DESC'
    );
    const sugerencias = await dbSupabase.query(
      'SELECT * FROM public.tbl_sugerencias_pqr ORDER BY fecha DESC'
    );

    res.json({
      alertas: alertas.rows,
      sugerencias: sugerencias.rows
    });
  } catch (error) {
    console.error('Error Supabase:', error.message);
    res.status(500).json({
      error: 'No se pudieron consultar las alertas y sugerencias.'
    });
  }
});

// Estado de conexiones y base activa
app.get('/api/conexiones', async (req, res) => {
  const [azure, amazon] = await Promise.all([
    comprobar(dbAzure),
    comprobar(dbAWS)
  ]);

  res.json({
    azure: azure ? 'Conectado' : 'Desconectado',
    amazon: amazon ? 'Conectado' : 'Desconectado',
    baseActiva: azure ? 'Azure' : amazon ? 'Amazon' : 'Ninguna'
  });
});

app.get('/api/estado-bases-datos', async (req, res) => {
  const [azure, amazon] = await Promise.all([
    comprobar(dbAzure),
    comprobar(dbAWS)
  ]);

  res.json({
    sistema: 'Cafetería SENA',
    fechaComprobacion: new Date().toISOString(),
    baseActiva: azure ? 'Azure' : amazon ? 'Amazon' : 'Ninguna',
    conexiones: [
      {
        nombre: 'Azure Database for MySQL',
        proveedor: 'Microsoft Azure',
        motor: 'MySQL',
        estado: azure ? 'Conectado' : 'Desconectado'
      },
      {
        nombre: 'Amazon RDS MySQL',
        proveedor: 'Amazon Web Services',
        motor: 'MySQL',
        estado: amazon ? 'Conectado' : 'Desconectado'
      }
    ]
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`API de Cafetería SENA activa en http://localhost:${PORT}`);
});
