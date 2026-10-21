
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const { Pool } = require('pg');

const app = express();

app.use(cors());
app.use(express.json());

// 1. Base de datos local MariaDB en la VM de Azure
const dbLocal = mysql.createPool({
  host: process.env.LOCAL_DB_HOST,
  port: Number(process.env.LOCAL_DB_PORT),
  user: process.env.LOCAL_DB_USER,
  password: process.env.LOCAL_DB_PASSWORD,
  database: process.env.LOCAL_DB_NAME,
  waitForConnections: true,
  connectionLimit: 5
});

// 2. Base de datos Azure Database for MySQL
const dbAzure = mysql.createPool({
  host: process.env.AZURE_DB_HOST,
  port: Number(process.env.AZURE_DB_PORT),
  user: process.env.AZURE_DB_USER,
  password: process.env.AZURE_DB_PASSWORD,
  database: process.env.AZURE_DB_NAME,
  ssl: { minVersion: 'TLSv1.2' },
  waitForConnections: true,
  connectionLimit: 5
});

// 3. Base de datos Supabase PostgreSQL
const dbSupabase = new Pool({
  host: process.env.SUPABASE_DB_HOST,
  port: Number(process.env.SUPABASE_DB_PORT),
  user: process.env.SUPABASE_DB_USER,
  password: process.env.SUPABASE_DB_PASSWORD,
  database: process.env.SUPABASE_DB_NAME,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 10000
});

// Ruta principal para comprobar que la API está activa
app.get('/', (req, res) => {
  res.json({
    mensaje: 'API de la Cafetería SENA funcionando',
    endpoints: [
      '/api/pos-local',
      '/api/clientes-azure',
      '/api/alertas-supabase'
    ]
  });
});

// Endpoint 1: productos y ventas locales
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
    console.error('Error en MariaDB:', error.message);
    res.status(500).json({
      error: 'No se pudieron consultar los productos y las ventas locales.'
    });
  }
});

// Endpoint 2: aprendices/clientes y empleados de Azure
app.get('/api/clientes-azure', async (req, res) => {
  try {
    const [clientes] = await dbAzure.query(
      'SELECT * FROM tbl_aprendices_clientes'
    );

    const [empleados] = await dbAzure.query(
      'SELECT * FROM tbl_empleados'
    );

    res.json({ clientes, empleados });
  } catch (error) {
    console.error('Error en Azure MySQL:', error.message);
    res.status(500).json({
      error: 'No se pudieron consultar los datos de Azure.'
    });
  }
});

// Endpoint 3: alertas de inventario y sugerencias/PQR
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
  console.error('Error en Supabase:', {
    message: error.message,
    code: error.code,
    detail: error.detail
  });

  res.status(500).json({
    error: 'No se pudieron consultar las alertas y sugerencias.'
  });
}

});

// Iniciar servidor
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`API de Cafetería SENA activa en http://localhost:${PORT}`);
});
