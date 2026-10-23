
import { useEffect, useState } from 'react';

const API = import.meta.env.VITE_API_URL || '';

function formatoPesos(valor) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(Number(valor) || 0);
}

function Tabla({ columnas, filas, vacio }) {
  if (!filas?.length) {
    return (
      <div className="text-secondary py-4 text-center">
        {vacio || 'No hay registros disponibles.'}
      </div>
    );
  }

  return (
    <div className="table-responsive">
      <table className="table align-middle mb-0">
        <thead>
          <tr>
            {columnas.map((col) => (
              <th key={col.key}>{col.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filas.map((fila, i) => (
            <tr key={fila.id_producto ?? fila.id_venta ?? fila.id_aprendiz ?? fila.id_empleado ?? fila.id_alerta ?? i}>
              {columnas.map((col) => (
                <td key={col.key}>
                  {col.render
                    ? col.render(fila[col.key], fila)
                    : (fila[col.key] ?? 'â€”')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function App() {
  const [seccion, setSeccion] = useState('Resumen');
  const [local, setLocal] = useState({ productos: [], ventas: [] });
  const [azure, setAzure] = useState({ clientes: [], empleados: [] });
  const [supabase, setSupabase] = useState({
    alertas: [],
    sugerencias: [],
  });
  const [estados, setEstados] = useState({
    local: 'cargando',
    azure: 'cargando',
    supabase: 'cargando',
  });

  async function cargarDatos() {
    const peticiones = [
      {
        nombre: 'local',
        url: `${API}/api/pos-local`,
        guardar: setLocal,
      },
      {
        nombre: 'azure',
        url: `${API}/api/clientes-azure`,
        guardar: setAzure,
      },
      {
        nombre: 'supabase',
        url: `${API}/api/alertas-supabase`,
        guardar: setSupabase,
      },
    ];

    await Promise.all(
      peticiones.map(async (peticion) => {
        setEstados((prev) => ({
          ...prev,
          [peticion.nombre]: 'cargando',
        }));

        try {
          const respuesta = await fetch(peticion.url);
          if (!respuesta.ok) {
            throw new Error(`Error HTTP ${respuesta.status}`);
          }

          const datos = await respuesta.json();
          peticion.guardar(datos);
          setEstados((prev) => ({
            ...prev,
            [peticion.nombre]: 'conectado',
          }));
        } catch (error) {
          console.error(`Error cargando ${peticion.nombre}:`, error);
          setEstados((prev) => ({
            ...prev,
            [peticion.nombre]: 'error',
          }));
        }
      })
    );
  }

  useEffect(() => {
    cargarDatos();
  }, []);

  const menu = [
    { nombre: 'Resumen', icono: 'bi-grid-1x2' },
    { nombre: 'Inventario', icono: 'bi-box-seam' },
    { nombre: 'Ventas', icono: 'bi-receipt' },
    { nombre: 'Aprendices', icono: 'bi-people' },
    { nombre: 'Empleados', icono: 'bi-person-badge' },
    { nombre: 'Alertas y PQR', icono: 'bi-bell' },
  ];

  const totalUnidades = local.productos.reduce(
    (total, producto) => total + Number(producto.stock_actual || 0),
    0
  );

  const totalProductos = local.productos.length;
  const totalAprendices = azure.clientes.length;
  const totalVentasRegistradas = local.ventas.length;

  function estadoConexion(nombre) {
    if (estados[nombre] === 'conectado') {
      return <span className="badge text-bg-success">Conectado</span>;
    }
    if (estados[nombre] === 'error') {
      return <span className="badge text-bg-danger">Error de conexiÃ³n</span>;
    }
    return <span className="badge text-bg-secondary">Conectandoâ€¦</span>;
  }

  function tituloSeccion() {
    const titulos = {
      Resumen: 'Resumen general',
      Inventario: 'Control de inventario',
      Ventas: 'Ventas registradas',
      Aprendices: 'Aprendices y clientes',
      Empleados: 'Personal de la cafeterÃ­a',
      'Alertas y PQR': 'Alertas y sugerencias',
    };
    return titulos[seccion];
  }

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon">
            <i className="bi bi-cup-hot-fill"></i>
          </div>
          <div>
            <h5>CafeterÃ­a SENA</h5>
            <small>Panel de control</small>
          </div>
        </div>

        <div className="menu-label">MENÃš PRINCIPAL</div>

        <nav className="nav flex-column">
          {menu.map((item) => (
            <button
              key={item.nombre}
              className={`menu-item ${seccion === item.nombre ? 'active' : ''}`}
              onClick={() => setSeccion(item.nombre)}
            >
              <i className={`bi ${item.icono}`}></i>
              <span>{item.nombre}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="connection-title">ESTADO DE LAS BASES</div>
          <div className="connection-row">
            <span>MariaDB local</span>
            {estadoConexion('local')}
          </div>
          <div className="connection-row">
            <span>Azure MySQL</span>
            {estadoConexion('azure')}
          </div>
          <div className="connection-row">
            <span>Supabase</span>
            {estadoConexion('supabase')}
          </div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div>
            <div className="eyebrow">GESTIÃ“N DE CAFETERÃA</div>
            <h4>{tituloSeccion()}</h4>
          </div>
          <button className="btn btn-light refresh-btn" onClick={cargarDatos}>
            <i className="bi bi-arrow-clockwise me-2"></i>
            Actualizar datos
          </button>
        </header>

        {estados.local === 'error' && (
          <div className="alert alert-danger">
            No fue posible consultar MariaDB. Verifica el backend y el tÃºnel SSH.
          </div>
        )}

        {seccion === 'Resumen' && (
          <>
            <div className="welcome-panel">
              <div>
                <span className="welcome-tag">PANEL ADMINISTRATIVO</span>
                <h2>Â¡Bienvenida al dashboard!</h2>
                <p>
                  Consulta el estado de la cafeterÃ­a y la informaciÃ³n de sus
                  diferentes fuentes de datos.
                </p>
              </div>
              <div className="welcome-icon">
                <i className="bi bi-cup-hot"></i>
              </div>
            </div>

            <div className="row g-3 my-2">
              <div className="col-12 col-md-6 col-xl-3">
                <div className="metric-card">
                  <div className="metric-icon lilac">
                    <i className="bi bi-box-seam"></i>
                  </div>
                  <p>Productos registrados</p>
                  <h3>{totalProductos}</h3>
                  <small>Referencias en inventario local</small>
                </div>
              </div>

              <div className="col-12 col-md-6 col-xl-3">
                <div className="metric-card">
                  <div className="metric-icon peach">
                    <i className="bi bi-stack"></i>
                  </div>
                  <p>Unidades en inventario</p>
                  <h3>{totalUnidades}</h3>
                  <small>Stock acumulado de productos</small>
                </div>
              </div>

              <div className="col-12 col-md-6 col-xl-3">
                <div className="metric-card">
                  <div className="metric-icon mint">
                    <i className="bi bi-receipt"></i>
                  </div>
                  <p>Ventas registradas</p>
                  <h3>{totalVentasRegistradas}</h3>
                  <small>Registros disponibles en MariaDB</small>
                </div>
              </div>

              <div className="col-12 col-md-6 col-xl-3">
                <div className="metric-card">
                  <div className="metric-icon pink">
                    <i className="bi bi-people"></i>
                  </div>
                  <p>Aprendices registrados</p>
                  <h3>{totalAprendices}</h3>
                  <small>Registros de Azure MySQL</small>
                </div>
              </div>
            </div>

            <div className="content-card mt-3">
              <div className="card-heading">
                <div>
                  <h5>Inventario reciente</h5>
                  <p>Productos consultados desde MariaDB</p>
                </div>
                <button className="btn btn-outline-secondary btn-sm" onClick={() => setSeccion('Inventario')}>
                  Ver inventario
                </button>
              </div>
              <Tabla
                columnas={[
                  { key: 'nombre_producto', label: 'Producto' },
                  { key: 'stock_actual', label: 'Stock disponible' },
                  { key: 'precio', label: 'Precio', render: (v) => formatoPesos(v) },
                ]}
                filas={local.productos.slice(0, 5)}
              />
            </div>

            <div className="content-card mt-3">
              <div className="card-heading">
                <div>
                  <h5>Ãšltimas ventas</h5>
                  <p>Registros de ventas disponibles</p>
                </div>
                <button className="btn btn-outline-secondary btn-sm" onClick={() => setSeccion('Ventas')}>
                  Ver ventas
                </button>
              </div>
              <Tabla
                columnas={[
                  { key: 'id_venta', label: 'N.Âº venta' },
                  { key: 'cantidad_vendida', label: 'Cantidad vendida' },
                  {
                    key: 'hora_venta',
                    label: 'Fecha y hora',
                    render: (v) => v ? new Date(v).toLocaleString('es-CO') : 'â€”',
                  },
                ]}
                filas={local.ventas.slice(0, 5)}
              />
            </div>
          </>
        )}

        {seccion === 'Inventario' && (
          <div className="content-card">
            <div className="card-heading">
              <div>
                <h5>Inventario de productos</h5>
                <p>Existencias y precios actuales</p>
              </div>
              <span className="badge text-bg-light">{totalProductos} productos</span>
            </div>
            <Tabla
              columnas={[
                { key: 'id_producto', label: 'ID' },
                { key: 'nombre_producto', label: 'Producto' },
                { key: 'stock_actual', label: 'Stock' },
                { key: 'precio', label: 'Precio', render: (v) => formatoPesos(v) },
              ]}
              filas={local.productos}
            />
          </div>
        )}

        {seccion === 'Ventas' && (
          <div className="content-card">
            <div className="card-heading">
              <div>
                <h5>Historial de ventas</h5>
                <p>Datos almacenados en la base local</p>
              </div>
              <span className="badge text-bg-light">{totalVentasRegistradas} registros</span>
            </div>
            <Tabla
              columnas={[
                { key: 'id_venta', label: 'ID venta' },
                { key: 'cantidad_vendida', label: 'Cantidad' },
                {
                  key: 'hora_venta',
                  label: 'Fecha y hora',
                  render: (v) => v ? new Date(v).toLocaleString('es-CO') : 'â€”',
                },
              ]}
              filas={local.ventas}
            />
          </div>
        )}

        {seccion === 'Aprendices' && (
          <div className="content-card">
            <div className="card-heading">
              <div>
                <h5>Aprendices y clientes</h5>
                <p>InformaciÃ³n consultada desde Azure MySQL</p>
              </div>
            </div>
            <Tabla
              columnas={[
                { key: 'id_aprendiz', label: 'ID' },
                { key: 'nombres', label: 'Nombre' },
                { key: 'documento', label: 'Documento' },
                { key: 'programa_formacion', label: 'Programa' },
                { key: 'saldo_tarjeta', label: 'Saldo', render: (v) => formatoPesos(v) },
              ]}
              filas={azure.clientes}
            />
          </div>
        )}

        {seccion === 'Empleados' && (
          <div className="content-card">
            <div className="card-heading">
              <div>
                <h5>Equipo de trabajo</h5>
                <p>Personal registrado en Azure MySQL</p>
              </div>
            </div>
            <Tabla
              columnas={[
                { key: 'id_empleado', label: 'ID' },
                { key: 'nombre', label: 'Nombre' },
                { key: 'turno', label: 'Turno' },
                { key: 'rol', label: 'Rol' },
              ]}
              filas={azure.empleados}
            />
          </div>
        )}

        {seccion === 'Alertas y PQR' && (
          <>
            {estados.supabase === 'error' && (
              <div className="alert alert-warning">
                No se pudo conectar con Supabase. Las otras secciones siguen
                disponibles. Revisa las credenciales y la conexiÃ³n PostgreSQL.
              </div>
            )}
            <div className="content-card mb-3">
              <div className="card-heading">
                <div>
                  <h5>Alertas de inventario</h5>
                  <p>InformaciÃ³n de Supabase PostgreSQL</p>
                </div>
              </div>
              <Tabla
                columnas={[
                  { key: 'id_alerta', label: 'ID' },
                  { key: 'mensaje_alerta', label: 'Mensaje' },
                  { key: 'criticidad', label: 'Criticidad' },
                  {
                    key: 'creado_en',
                    label: 'Fecha',
                    render: (v) => v ? new Date(v).toLocaleString('es-CO') : 'â€”',
                  },
                ]}
                filas={supabase.alertas}
                vacio={estados.supabase === 'error' ? 'Datos no disponibles por un error de conexiÃ³n.' : 'No hay alertas registradas.'}
              />
            </div>

            <div className="content-card">
              <div className="card-heading">
                <div>
                  <h5>Sugerencias y quejas (PQR)</h5>
                  <p>Comentarios almacenados en Supabase</p>
                </div>
              </div>
              <Tabla
                columnas={[
                  { key: 'id_pqr', label: 'ID' },
                  { key: 'tipo', label: 'Tipo' },
                  { key: 'comentario', label: 'Comentario' },
                  {
                    key: 'fecha',
                    label: 'Fecha',
                    render: (v) => v ? new Date(v).toLocaleString('es-CO') : 'â€”',
                  },
                ]}
                filas={supabase.sugerencias}
                vacio={estados.supabase === 'error' ? 'Datos no disponibles por un error de conexiÃ³n.' : 'No hay sugerencias registradas.'}
              />
            </div>
          </>
        )}

        <footer className="page-footer">
          Dashboard de Control de CafeterÃ­a SENA Â· React + Node.js Â· Arquitectura multi-cloud
        </footer>
      </main>
    </div>
  );
}

export default App;

