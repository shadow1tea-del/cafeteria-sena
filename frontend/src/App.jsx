
import { useEffect, useState } from 'react';

const API = import.meta.env.VITE_API_URL || '';

function formatoPesos(valor) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0
  }).format(Number(valor) || 0);
}

function Tabla({ columnas, filas, vacio }) {
  if (!filas?.length) {
    return <div className="text-secondary py-4 text-center">{vacio || 'No hay registros disponibles.'}</div>;
  }

  return (
    <div className="table-responsive">
      <table className="table table-hover align-middle mb-0">
        <thead>
          <tr>{columnas.map(c => <th key={c.key}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {filas.map((fila, i) => (
            <tr key={fila.id_producto ?? fila.id_venta ?? fila.id_aprendiz ?? fila.id_empleado ?? fila.id_alerta ?? i}>
              {columnas.map(c => (
                <td key={c.key}>{c.render ? c.render(fila[c.key], fila) : (fila[c.key] ?? '—')}</td>
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
  const [supabase, setSupabase] = useState({ alertas: [], sugerencias: [] });

  const [estadoNube, setEstadoNube] = useState({ azure: 'cargando', amazon: 'cargando' });
  const [estados, setEstados] = useState({ local: 'cargando', azure: 'cargando', supabase: 'cargando' });
  const [baseActiva, setBaseActiva] = useState('Verificando');
  const [mensaje, setMensaje] = useState('');
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);

  const [aprendizEditando, setAprendizEditando] = useState(null);
  const [empleadoEditando, setEmpleadoEditando] = useState(null);

  const [formAprendiz, setFormAprendiz] = useState({
    nombres: '', documento: '', programa_formacion: '', saldo_tarjeta: '0'
  });

  const [formEmpleado, setFormEmpleado] = useState({
    nombre: '', turno: 'Mañana', rol: ''
  });

  async function pedir(url, opciones = {}) {
    const respuesta = await fetch(`${API}${url}`, {
      ...opciones,
      headers: {
        'Content-Type': 'application/json',
        ...(opciones.headers || {})
      }
    });

    const datos = await respuesta.json().catch(() => ({}));

    if (!respuesta.ok) {
      throw new Error(datos.error || `Error HTTP ${respuesta.status}`);
    }

    return datos;
  }

  async function cargarEstadoNube() {
    try {
      const datos = await pedir('/api/estado-bases-datos');
      const azureEstado = datos.conexiones.find(x => x.proveedor === 'Microsoft Azure');
      const amazonEstado = datos.conexiones.find(x => x.proveedor === 'Amazon Web Services');

      setEstadoNube({
        azure: azureEstado?.estado === 'Conectado' ? 'conectado' : 'error',
        amazon: amazonEstado?.estado === 'Conectado' ? 'conectado' : 'error'
      });

      setBaseActiva(datos.baseActiva || 'Ninguna');
    } catch (e) {
      console.error(e);
      setEstadoNube({ azure: 'error', amazon: 'error' });
      setBaseActiva('No disponible');
    }
  }

  async function cargarDatos() {
    const tareas = [
      {
        nombre: 'local',
        ejecutar: async () => setLocal(await pedir('/api/pos-local'))
      },
      {
        nombre: 'azure',
        ejecutar: async () => {
          const datos = await pedir('/api/clientes-azure');
          setAzure({ clientes: datos.clientes || [], empleados: datos.empleados || [] });
          if (datos.baseActiva) setBaseActiva(datos.baseActiva);
        }
      },
      {
        nombre: 'supabase',
        ejecutar: async () => setSupabase(await pedir('/api/alertas-supabase'))
      }
    ];

    await Promise.all(tareas.map(async tarea => {
      setEstados(prev => ({ ...prev, [tarea.nombre]: 'cargando' }));
      try {
        await tarea.ejecutar();
        setEstados(prev => ({ ...prev, [tarea.nombre]: 'conectado' }));
      } catch (e) {
        console.error(`Error ${tarea.nombre}:`, e);
        setEstados(prev => ({ ...prev, [tarea.nombre]: 'error' }));
      }
    }));

    await cargarEstadoNube();
  }

  useEffect(() => {
    cargarDatos();
  }, []);

  function limpiarMensajes() {
    setMensaje('');
    setError('');
  }

  async function guardarAprendiz(e) {
    e.preventDefault();
    limpiarMensajes();
    setGuardando(true);

    try {
      const metodo = aprendizEditando ? 'PUT' : 'POST';
      const ruta = aprendizEditando
        ? `/api/aprendices/${aprendizEditando}`
        : '/api/aprendices';

      const datos = await pedir(ruta, {
        method: metodo,
        body: JSON.stringify({
          ...formAprendiz,
          saldo_tarjeta: Number(formAprendiz.saldo_tarjeta)
        })
      });

      setMensaje(datos.mensaje || 'Aprendiz guardado correctamente.');
      setAprendizEditando(null);
      setFormAprendiz({ nombres: '', documento: '', programa_formacion: '', saldo_tarjeta: '0' });
      await cargarDatos();
    } catch (e) {
      setError(e.message);
    } finally {
      setGuardando(false);
    }
  }

  function editarAprendiz(fila) {
    limpiarMensajes();
    setAprendizEditando(fila.id_aprendiz);
    setFormAprendiz({
      nombres: fila.nombres || '',
      documento: fila.documento || '',
      programa_formacion: fila.programa_formacion || '',
      saldo_tarjeta: String(fila.saldo_tarjeta ?? 0)
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function eliminarAprendiz(id) {
    if (!window.confirm('¿Seguro que deseas eliminar este aprendiz?')) return;
    limpiarMensajes();

    try {
      const datos = await pedir(`/api/aprendices/${id}`, { method: 'DELETE' });
      setMensaje(datos.mensaje || 'Aprendiz eliminado.');
      if (aprendizEditando === id) cancelarAprendiz();
      await cargarDatos();
    } catch (e) {
      setError(e.message);
    }
  }

  function cancelarAprendiz() {
    setAprendizEditando(null);
    setFormAprendiz({ nombres: '', documento: '', programa_formacion: '', saldo_tarjeta: '0' });
  }

  async function guardarEmpleado(e) {
    e.preventDefault();
    limpiarMensajes();
    setGuardando(true);

    try {
      const metodo = empleadoEditando ? 'PUT' : 'POST';
      const ruta = empleadoEditando
        ? `/api/empleados/${empleadoEditando}`
        : '/api/empleados';

      const datos = await pedir(ruta, {
        method: metodo,
        body: JSON.stringify(formEmpleado)
      });

      setMensaje(datos.mensaje || 'Empleado guardado correctamente.');
      setEmpleadoEditando(null);
      setFormEmpleado({ nombre: '', turno: 'Mañana', rol: '' });
      await cargarDatos();
    } catch (e) {
      setError(e.message);
    } finally {
      setGuardando(false);
    }
  }

  function editarEmpleado(fila) {
    limpiarMensajes();
    setEmpleadoEditando(fila.id_empleado);
    setFormEmpleado({
      nombre: fila.nombre || '',
      turno: fila.turno || 'Mañana',
      rol: fila.rol || ''
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function eliminarEmpleado(id) {
    if (!window.confirm('¿Seguro que deseas eliminar este empleado?')) return;
    limpiarMensajes();

    try {
      const datos = await pedir(`/api/empleados/${id}`, { method: 'DELETE' });
      setMensaje(datos.mensaje || 'Empleado eliminado.');
      if (empleadoEditando === id) cancelarEmpleado();
      await cargarDatos();
    } catch (e) {
      setError(e.message);
    }
  }

  function cancelarEmpleado() {
    setEmpleadoEditando(null);
    setFormEmpleado({ nombre: '', turno: 'Mañana', rol: '' });
  }

  const menu = [
    { nombre: 'Resumen', icono: 'bi-grid-1x2' },
    { nombre: 'Inventario', icono: 'bi-box-seam' },
    { nombre: 'Ventas', icono: 'bi-receipt' },
    { nombre: 'Aprendices', icono: 'bi-people' },
    { nombre: 'Empleados', icono: 'bi-person-badge' },
    { nombre: 'Alertas y PQR', icono: 'bi-bell' }
  ];

  const totalUnidades = local.productos.reduce((t, p) => t + Number(p.stock_actual || 0), 0);
  const totalProductos = local.productos.length;
  const totalAprendices = azure.clientes.length;
  const totalVentas = local.ventas.length;

  function estadoConexion(nombre) {
    if (estados[nombre] === 'conectado') return <span className="badge text-bg-success">Conectado</span>;
    if (estados[nombre] === 'error') return <span className="badge text-bg-danger">Error</span>;
    return <span className="badge text-bg-secondary">Verificando...</span>;
  }

  function estadoNubeBadge(nombre) {
    if (estadoNube[nombre] === 'conectado') return <span className="badge text-bg-success">Conectado</span>;
    if (estadoNube[nombre] === 'error') return <span className="badge text-bg-danger">Desconectado</span>;
    return <span className="badge text-bg-secondary">Verificando...</span>;
  }

  const titulos = {
    Resumen: 'Resumen general',
    Inventario: 'Control de inventario',
    Ventas: 'Ventas registradas',
    Aprendices: 'Aprendices y clientes',
    Empleados: 'Personal de la cafetería',
    'Alertas y PQR': 'Alertas y sugerencias'
  };

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon"><i className="bi bi-cup-hot-fill"></i></div>
          <div><h5>Cafetería SENA</h5><small>Panel de control</small></div>
        </div>

        <div className="menu-label">MENÚ PRINCIPAL</div>
        <nav className="nav flex-column">
          {menu.map(item => (
            <button
              key={item.nombre}
              className={`menu-item ${seccion === item.nombre ? 'active' : ''}`}
              onClick={() => { setSeccion(item.nombre); limpiarMensajes(); }}
            >
              <i className={`bi ${item.icono}`}></i>
              <span>{item.nombre}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="connection-title">ESTADO DE LAS BASES</div>
          <div className="connection-row"><span>MariaDB local</span>{estadoConexion('local')}</div>
          <div className="connection-row"><span>Azure MySQL</span>{estadoNubeBadge('azure')}</div>
          <div className="connection-row"><span>Amazon RDS</span>{estadoNubeBadge('amazon')}</div>
          <div className="connection-row"><span>Supabase</span>{estadoConexion('supabase')}</div>
          <small className="d-block mt-2 text-secondary">Base activa: {baseActiva}</small>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div>
            <div className="eyebrow">GESTIÓN DE CAFETERÍA</div>
            <h4>{titulos[seccion]}</h4>
          </div>
          <button className="btn btn-light refresh-btn" onClick={cargarDatos}>
            <i className="bi bi-arrow-clockwise me-2"></i>Actualizar datos
          </button>
        </header>

        {mensaje && <div className="alert alert-success alert-dismissible">{mensaje}<button className="btn-close" onClick={() => setMensaje('')}></button></div>}
        {error && <div className="alert alert-danger alert-dismissible">{error}<button className="btn-close" onClick={() => setError('')}></button></div>}

        {seccion === 'Resumen' && (
          <>
            <div className="welcome-panel">
              <div>
                <span className="welcome-tag">PANEL ADMINISTRATIVO</span>
                <h2>¡Bienvenida al dashboard!</h2>
                <p>Consulta el estado de la cafetería y sus diferentes fuentes de datos.</p>
                <p className="mb-0"><strong>Base de datos activa:</strong> {baseActiva}</p>
              </div>
              <div className="welcome-icon"><i className="bi bi-cup-hot"></i></div>
            </div>

            <div className="row g-3 my-2">
              {[
                ['Productos registrados', totalProductos, 'bi-box-seam', 'lilac'],
                ['Unidades en inventario', totalUnidades, 'bi-stack', 'peach'],
                ['Ventas registradas', totalVentas, 'bi-receipt', 'mint'],
                ['Aprendices registrados', totalAprendices, 'bi-people', 'pink']
              ].map(([titulo, valor, icono, color]) => (
                <div className="col-12 col-md-6 col-xl-3" key={titulo}>
                  <div className="metric-card">
                    <div className={`metric-icon ${color}`}><i className={`bi ${icono}`}></i></div>
                    <p>{titulo}</p><h3>{valor}</h3>
                  </div>
                </div>
              ))}
            </div>

            <div className="content-card mt-3">
              <div className="card-heading"><div><h5>Inventario reciente</h5><p>Productos consultados desde MariaDB</p></div></div>
              <Tabla columnas={[
                { key: 'nombre_producto', label: 'Producto' },
                { key: 'stock_actual', label: 'Stock disponible' },
                { key: 'precio', label: 'Precio', render: v => formatoPesos(v) }
              ]} filas={local.productos.slice(0, 5)} />
            </div>

            <div className="content-card mt-3">
              <div className="card-heading"><div><h5>Últimas ventas</h5><p>Registros de ventas disponibles</p></div></div>
              <Tabla columnas={[
                { key: 'id_venta', label: 'N.º venta' },
                { key: 'cantidad_vendida', label: 'Cantidad vendida' },
                { key: 'hora_venta', label: 'Fecha y hora', render: v => v ? new Date(v).toLocaleString('es-CO') : '—' }
              ]} filas={local.ventas.slice(0, 5)} />
            </div>
          </>
        )}

        {seccion === 'Inventario' && (
          <div className="content-card">
            <div className="card-heading"><div><h5>Inventario de productos</h5><p>Existencias y precios actuales</p></div></div>
            <Tabla columnas={[
              { key: 'id_producto', label: 'ID' },
              { key: 'nombre_producto', label: 'Producto' },
              { key: 'stock_actual', label: 'Stock' },
              { key: 'precio', label: 'Precio', render: v => formatoPesos(v) }
            ]} filas={local.productos} />
          </div>
        )}

        {seccion === 'Ventas' && (
          <div className="content-card">
            <div className="card-heading"><div><h5>Historial de ventas</h5><p>Datos almacenados en MariaDB</p></div></div>
            <Tabla columnas={[
              { key: 'id_venta', label: 'ID venta' },
              { key: 'cantidad_vendida', label: 'Cantidad' },
              { key: 'hora_venta', label: 'Fecha y hora', render: v => v ? new Date(v).toLocaleString('es-CO') : '—' }
            ]} filas={local.ventas} />
          </div>
        )}

        {seccion === 'Aprendices' && (
          <>
            <div className="content-card mb-3">
              <div className="card-heading">
                <div>
                  <h5>{aprendizEditando ? `Editar aprendiz #${aprendizEditando}` : 'Registrar aprendiz'}</h5>
                  <p>Los datos se guardan en la base de datos activa: {baseActiva}</p>
                </div>
              </div>
              <form onSubmit={guardarAprendiz}>
                <div className="row g-3">
                  <div className="col-md-6">
                    <label className="form-label">Nombres completos</label>
                    <input className="form-control" required value={formAprendiz.nombres} onChange={e => setFormAprendiz({ ...formAprendiz, nombres: e.target.value })} />
                  </div>
                  <div className="col-md-6">
                    <label className="form-label">Documento</label>
                    <input className="form-control" required value={formAprendiz.documento} onChange={e => setFormAprendiz({ ...formAprendiz, documento: e.target.value })} />
                  </div>
                  <div className="col-md-6">
                    <label className="form-label">Programa de formación</label>
                    <input className="form-control" required value={formAprendiz.programa_formacion} onChange={e => setFormAprendiz({ ...formAprendiz, programa_formacion: e.target.value })} />
                  </div>
                  <div className="col-md-6">
                    <label className="form-label">Saldo de tarjeta (COP)</label>
                    <input className="form-control" type="number" min="0" step="0.01" required value={formAprendiz.saldo_tarjeta} onChange={e => setFormAprendiz({ ...formAprendiz, saldo_tarjeta: e.target.value })} />
                  </div>
                </div>
                <div className="d-flex gap-2 mt-3">
                  <button className="btn btn-primary" disabled={guardando}>{guardando ? 'Guardando...' : aprendizEditando ? 'Guardar cambios' : 'Registrar aprendiz'}</button>
                  {aprendizEditando && <button type="button" className="btn btn-outline-secondary" onClick={cancelarAprendiz}>Cancelar</button>}
                </div>
              </form>
            </div>

            <div className="content-card">
              <div className="card-heading"><div><h5>Aprendices y clientes</h5><p>{azure.clientes.length} registros · Base activa: {baseActiva}</p></div></div>
              <Tabla columnas={[
                { key: 'id_aprendiz', label: 'ID' },
                { key: 'nombres', label: 'Nombre' },
                { key: 'documento', label: 'Documento' },
                { key: 'programa_formacion', label: 'Programa' },
                { key: 'saldo_tarjeta', label: 'Saldo', render: v => formatoPesos(v) },
                { key: 'acciones', label: 'Acciones', render: (_, fila) => (
                  <div className="d-flex gap-2">
                    <button className="btn btn-sm btn-outline-primary" onClick={() => editarAprendiz(fila)}>Editar</button>
                    <button className="btn btn-sm btn-outline-danger" onClick={() => eliminarAprendiz(fila.id_aprendiz)}>Eliminar</button>
                  </div>
                )}
              ]} filas={azure.clientes} />
            </div>
          </>
        )}

        {seccion === 'Empleados' && (
          <>
            <div className="content-card mb-3">
              <div className="card-heading">
                <div>
                  <h5>{empleadoEditando ? `Editar empleado #${empleadoEditando}` : 'Registrar empleado'}</h5>
                  <p>Los datos se guardan en la base de datos activa: {baseActiva}</p>
                </div>
              </div>
              <form onSubmit={guardarEmpleado}>
                <div className="row g-3">
                  <div className="col-md-4">
                    <label className="form-label">Nombre completo</label>
                    <input className="form-control" required value={formEmpleado.nombre} onChange={e => setFormEmpleado({ ...formEmpleado, nombre: e.target.value })} />
                  </div>
                  <div className="col-md-4">
                    <label className="form-label">Turno</label>
                    <select className="form-select" value={formEmpleado.turno} onChange={e => setFormEmpleado({ ...formEmpleado, turno: e.target.value })}>
                      <option>Mañana</option><option>Tarde</option><option>Noche</option>
                    </select>
                  </div>
                  <div className="col-md-4">
                    <label className="form-label">Rol</label>
                    <input className="form-control" required value={formEmpleado.rol} onChange={e => setFormEmpleado({ ...formEmpleado, rol: e.target.value })} />
                  </div>
                </div>
                <div className="d-flex gap-2 mt-3">
                  <button className="btn btn-primary" disabled={guardando}>{guardando ? 'Guardando...' : empleadoEditando ? 'Guardar cambios' : 'Registrar empleado'}</button>
                  {empleadoEditando && <button type="button" className="btn btn-outline-secondary" onClick={cancelarEmpleado}>Cancelar</button>}
                </div>
              </form>
            </div>

            <div className="content-card">
              <div className="card-heading"><div><h5>Equipo de trabajo</h5><p>{azure.empleados.length} registros · Base activa: {baseActiva}</p></div></div>
              <Tabla columnas={[
                { key: 'id_empleado', label: 'ID' },
                { key: 'nombre', label: 'Nombre' },
                { key: 'turno', label: 'Turno' },
                { key: 'rol', label: 'Rol' },
                { key: 'acciones', label: 'Acciones', render: (_, fila) => (
                  <div className="d-flex gap-2">
                    <button className="btn btn-sm btn-outline-primary" onClick={() => editarEmpleado(fila)}>Editar</button>
                    <button className="btn btn-sm btn-outline-danger" onClick={() => eliminarEmpleado(fila.id_empleado)}>Eliminar</button>
                  </div>
                )}
              ]} filas={azure.empleados} />
            </div>
          </>
        )}

        {seccion === 'Alertas y PQR' && (
          <>
            <div className="content-card mb-3">
              <div className="card-heading"><div><h5>Alertas de inventario</h5><p>Información de Supabase PostgreSQL</p></div></div>
              <Tabla columnas={[
                { key: 'id_alerta', label: 'ID' },
                { key: 'mensaje_alerta', label: 'Mensaje' },
                { key: 'criticidad', label: 'Criticidad' },
                { key: 'creado_en', label: 'Fecha', render: v => v ? new Date(v).toLocaleString('es-CO') : '—' }
              ]} filas={supabase.alertas} />
            </div>
            <div className="content-card">
              <div className="card-heading"><div><h5>Sugerencias y quejas (PQR)</h5><p>Comentarios almacenados en Supabase</p></div></div>
              <Tabla columnas={[
                { key: 'id_pqr', label: 'ID' },
                { key: 'tipo', label: 'Tipo' },
                { key: 'comentario', label: 'Comentario' },
                { key: 'fecha', label: 'Fecha', render: v => v ? new Date(v).toLocaleString('es-CO') : '—' }
              ]} filas={supabase.sugerencias} />
            </div>
          </>
        )}

        <footer className="page-footer">
          Dashboard de Control de Cafetería SENA · React + Node.js · Arquitectura multi-cloud
        </footer>
      </main>
    </div>
  );
}

export default App;
