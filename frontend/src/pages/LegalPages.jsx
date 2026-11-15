import React, { useEffect } from 'react';
import { Button, Card, Tag } from 'antd';
import {
  ArrowLeftOutlined,
  SafetyCertificateOutlined,
  FileProtectOutlined,
  LockOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons';
import { Link, useNavigate } from 'react-router-dom';
import IterumxLogo from '../components/IterumxLogo';

const LegalLayout = ({ badgeText, title, subtitle, lastUpdated, activePage, children }) => {
  const navigate = useNavigate();

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [activePage]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 flex flex-col">
      {/* Barra Superior */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-slate-200 px-6 py-4">
        <div className="max-w-5xl mx-auto flex flex-wrap items-center justify-between gap-4">
          <div className="cursor-pointer" onClick={() => navigate('/landing')}>
            <IterumxLogo size="sm" showSubtitle subtitle="PLATAFORMA CONTABLE Y FISCAL" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link to="/terminos-y-condiciones">
              <Button
                type={activePage === 'terms' ? 'primary' : 'default'}
                icon={<FileProtectOutlined />}
                style={
                  activePage === 'terms'
                    ? { backgroundColor: '#1E2C5E', borderColor: '#1E2C5E', fontWeight: 400 }
                    : { fontWeight: 400 }
                }
              >
                Términos y Condiciones
              </Button>
            </Link>
            <Link to="/aviso-de-privacidad">
              <Button
                type={activePage === 'privacy' ? 'primary' : 'default'}
                icon={<LockOutlined />}
                style={
                  activePage === 'privacy'
                    ? { backgroundColor: '#1E2C5E', borderColor: '#1E2C5E', fontWeight: 400 }
                    : { fontWeight: 400 }
                }
              >
                Aviso de Privacidad
              </Button>
            </Link>
            <Button
              icon={<ArrowLeftOutlined />}
              onClick={() => navigate('/landing')}
              style={{ fontWeight: 400 }}
            >
              Volver a la Landing
            </Button>
          </div>
        </div>
      </header>

      {/* Encabezado Hero Legal */}
      <section
        className="text-white py-12 px-6"
        style={{
          background: 'linear-gradient(135deg, #0b1536 0%, #1E2C5E 60%, #133b4f 100%)',
        }}
      >
        <div className="max-w-5xl mx-auto">
          <Tag
            color="green"
            className="uppercase tracking-wider px-3 py-1 mb-3 border-0"
            style={{ backgroundColor: 'rgba(87, 168, 44, 0.25)', color: '#a7f3d0' }}
          >
            {badgeText}
          </Tag>
          <h1 className="text-2xl md:text-4xl text-white font-normal m-0" style={{ fontWeight: 400 }}>
            {title}
          </h1>
          <p className="text-slate-200 text-sm md:text-base mt-2 mb-0 max-w-3xl font-normal">
            {subtitle}
          </p>
          <div className="text-xs text-slate-300 mt-4">
            Última actualización: {lastUpdated} · Aplicable en los Estados Unidos Mexicanos
          </div>
        </div>
      </section>

      {/* Contenido Principal */}
      <main className="max-w-5xl w-full mx-auto px-6 py-10 flex-1">
        <Card className="rounded-2xl border border-slate-200 shadow-sm bg-white p-2 md:p-6">
          <div className="space-y-6 text-sm md:text-base text-slate-700 leading-relaxed font-normal">
            {children}
          </div>
        </Card>
      </main>

      {/* Pie de Página */}
      <footer className="bg-[#06122c] text-slate-300 py-8 px-6 border-t border-slate-800">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs">
          <div>
            © {new Date().getFullYear()} <span className="text-white">Iterumx</span> — Plataforma de
            Contabilidad Fiscal e Inteligencia Financiera.
          </div>
          <div className="flex items-center gap-4">
            <Link
              to="/terminos-y-condiciones"
              className="text-slate-200 hover:text-white underline underline-offset-4"
            >
              Términos y Condiciones
            </Link>
            <span className="text-slate-600">|</span>
            <Link
              to="/aviso-de-privacidad"
              className="text-slate-200 hover:text-white underline underline-offset-4"
            >
              Aviso de Privacidad
            </Link>
            <span className="text-slate-600">|</span>
            <Link
              to="/landing"
              className="text-emerald-400 hover:text-emerald-300 underline underline-offset-4"
            >
              Inicio
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
};

export const TermsAndConditionsPage = () => {
  return (
    <LegalLayout
      activePage="terms"
      badgeText="Marco Legal y Condiciones de Servicio"
      title="Términos y Condiciones de Uso de Iterumx"
      subtitle="Condiciones generales que regulan el acceso y uso de la Plataforma de Contabilidad Fiscal, Automatización CFDI 4.0 e Inteligencia Financiera Iterumx."
      lastUpdated="Noviembre 2026"
    >
      <section className="space-y-2">
        <h2 className="text-lg md:text-xl text-slate-900 font-normal m-0" style={{ fontWeight: 400 }}>
          1. Aceptación de los Términos
        </h2>
        <p className="m-0">
          El presente contrato describe los Términos y Condiciones Generales aplicables al uso de los
          servicios, módulos contables, herramientas de cálculo fiscal y asistente de inteligencia
          artificial ofrecidos dentro de la plataforma tecnológica <span>Iterumx</span>. Al registrar una
          organización, despacho contable o empresa, o al hacer uso de cualquiera de sus funcionalidades,
          el Usuario acepta sujetarse a las presentes disposiciones.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg md:text-xl text-slate-900 font-normal m-0" style={{ fontWeight: 400 }}>
          2. Descripción del Servicio
        </h2>
        <p className="m-0">
          Iterumx es una plataforma en la nube diseñada para despachos contables, contadores independientes
          y empresas en México que permite la recepción y procesamiento de archivos XML (CFDI 4.0 de
          ingresos, egresos, nómina y complementos de pago), generación de pólizas contables, estados
          financieros bajo NIF, conciliación bancaria, cédulas fiscales de IVA, ISR, IEPS, DIOT,
          Contabilidad Electrónica Anexo 24, validación del Artículo 69-B del CFF y asistencia mediante
          el copiloto contable <span>Iterumbot</span>.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg md:text-xl text-slate-900 font-normal m-0" style={{ fontWeight: 400 }}>
          3. Periodo de Prueba Gratuita y Suscripciones
        </h2>
        <p className="m-0">
          Todo nuevo despacho u organización registrada cuenta con un periodo de prueba gratuita de 14
          días naturales sin requerir tarjeta de crédito al momento del registro. Al concluir dicho
          periodo, el titular podrá elegir el plan mensual o anual que se adapte a su volumen de empresas
          (RFCs), usuarios y CFDIs procesados, realizando el pago mediante tarjeta bancaria, transferencia
          interbancaria SPEI referenciada o pago en efectivo en comercios afiliados, recibiendo su
          comprobante fiscal CFDI 4.0 correspondiente.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg md:text-xl text-slate-900 font-normal m-0" style={{ fontWeight: 400 }}>
          4. Propiedad de la Información Contable y Fiscal
        </h2>
        <p className="m-0">
          El Usuario y sus clientes conservan en todo momento el 100% de la titularidad y propiedad sobre
          sus catálogos de cuentas, pólizas contables, balanzas de comprobación, comprobantes fiscales
          digitales (XML/PDF) y estados de cuenta bancarios almacenados en Iterumx. El Usuario puede
          exportar su información en formatos estándar (XML, TXT, CSV, Excel y PDF) en cualquier momento.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg md:text-xl text-slate-900 font-normal m-0" style={{ fontWeight: 400 }}>
          5. Infraestructura y Seguridad en Servidores AWS
        </h2>
        <p className="m-0">
          La información procesada en Iterumx se aloja en servidores seguros de Amazon Web Services (AWS)
          bajo esquemas de aislamiento lógico por organización, cifrado en tránsito mediante protocolos
          SSL/TLS, control de acceso por roles (Administrador, Contador, Auxiliar y Portal de Cliente),
          registro en bitácora de auditoría y respaldos automatizados periódicos.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg md:text-xl text-slate-900 font-normal m-0" style={{ fontWeight: 400 }}>
          6. Uso del Copiloto Contable Iterumbot y Responsabilidad Profesional
        </h2>
        <p className="m-0">
          Las cédulas de impuestos, papeles de trabajo, validaciones automáticas y sugerencias emitidas
          por el asistente inteligente Iterumbot constituyen herramientas tecnológicas de apoyo y
          automatización. La supervisión final, interpretación normativa y presentación de declaraciones
          ante el Servicio de Administración Tributaria (SAT) recaen en el contador público o representante
          legal del contribuyente.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg md:text-xl text-slate-900 font-normal m-0" style={{ fontWeight: 400 }}>
          7. Legislación Aplicable y Jurisdicción
        </h2>
        <p className="m-0">
          Para la interpretación, cumplimiento y ejecución de los presentes Términos y Condiciones, las
          partes se someten a las leyes federales vigentes en los Estados Unidos Mexicanos.
        </p>
      </section>
    </LegalLayout>
  );
};

export const PrivacyNoticePage = () => {
  return (
    <LegalLayout
      activePage="privacy"
      badgeText="Protección de Datos Personales (LFPDPPP)"
      title="Aviso de Privacidad Integral de Iterumx"
      subtitle="En cumplimiento con la Ley Federal de Protección de Datos Personales en Posesión de los Particulares (LFPDPPP) y su Reglamento."
      lastUpdated="Noviembre 2026"
    >
      <section className="space-y-2">
        <h2 className="text-lg md:text-xl text-slate-900 font-normal m-0" style={{ fontWeight: 400 }}>
          1. Identidad y domicilio del Responsable del Tratamiento de Datos
        </h2>
        <p className="m-0">
          El responsable del tratamiento de sus datos personales es el CPC Salvador García Salas, quien administra la plataforma ITERUMX® (Plataforma de Contabilidad Fiscal e Inteligencia Financiera) y sus subdominios. Nuestro domicilio se encuentra ubicado en Hombres ilustres 51-B Plateros C.P. 99158 Fresnillo Zacatecas México. Esta responsabilidad incluye el uso, tratamiento, almacenamiento y protección de los datos personales, financieros y fiscales que usted proporcione o cargue dentro de nuestra plataforma, observando los principios de licitud, consentimiento, información, calidad, finalidad, lealtad, proporcionalidad y responsabilidad previstos en la legislación mexicana.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg md:text-xl text-slate-900 font-normal m-0" style={{ fontWeight: 400 }}>
          2. Datos Personales y Fiscales Recabados
        </h2>
        <p className="m-0">
          Para la adecuada prestación de nuestros servicios contables y fiscales, recabamos las siguientes
          categorías de información:
        </p>
        <ul className="list-disc pl-6 space-y-1 m-0">
          <li>
            Datos de identificación y contacto del titular o despacho: nombre completo, correo electrónico,
            teléfono de contacto, nombre comercial de la firma y puesto.
          </li>
          <li>
            Datos fiscales de facturación y contribuyentes registrados: Registro Federal de Contribuyentes
            (RFC), razón o denominación social, régimen fiscal, código postal fiscal y domicilio fiscal.
          </li>
          <li>
            Información contable y comprobantes fiscales (CFDI 4.0): archivos XML de ingresos, egresos,
            complementos de pago (REP 2.0), recibos de nómina, estados de cuenta bancarios para
            conciliación y balanzas de comprobación.
          </li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg md:text-xl text-slate-900 font-normal m-0" style={{ fontWeight: 400 }}>
          3. Finalidades del Tratamiento de los Datos
        </h2>
        <p className="m-0">
          Sus datos personales y los de las empresas que administra serán utilizados para las siguientes
          finalidades primarias indispensables para el servicio:
        </p>
        <ul className="list-disc pl-6 space-y-1 m-0">
          <li>
            Proveer acceso seguro a su entorno multi-empresa dentro de la plataforma Iterumx.
          </li>
          <li>
            Automatizar la lectura de CFDI 4.0, contabilización de pólizas, cálculo de impuestos (IVA, ISR,
            IEPS), generación de DIOT, Contabilidad Electrónica y consultas del asistente Iterumbot.
          </li>
          <li>
            Emitir la facturación electrónica CFDI 4.0 correspondiente a la suscripción de su plan activo.
          </li>
          <li>
            Brindar soporte técnico, notificaciones operativas y resguardo de bitácoras de seguridad.
          </li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg md:text-xl text-slate-900 font-normal m-0" style={{ fontWeight: 400 }}>
          4. Medidas de Seguridad y Alojamiento en AWS
        </h2>
        <p className="m-0">
          Iterumx resguarda toda la información en servidores seguros de Amazon Web Services (AWS) bajo
          controles de seguridad administrativos, técnicos y físicos. No comercializamos, rentamos ni
          transferimos a terceros la información contable, fiscal ni los archivos XML de nuestros usuarios.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg md:text-xl text-slate-900 font-normal m-0" style={{ fontWeight: 400 }}>
          5. Ejercicio de Derechos ARCO (Acceso, Rectificación, Cancelación y Oposición)
        </h2>
        <p className="m-0">
          Usted tiene derecho a conocer qué datos personales tenemos de usted, para qué los utilizamos y
          las condiciones del uso que les damos (Acceso). Asimismo, es su derecho solicitar la corrección
          de su información personal (Rectificación); que la eliminemos de nuestros registros cuando
          considere que no está siendo utilizada adecuadamente (Cancelación); así como oponerse al uso de
          sus datos personales para fines específicos (Oposición). Puede ejercer sus derechos ARCO o
          exportar y eliminar sus datos directamente desde el módulo de Soporte Técnico y Administración
          dentro de la plataforma.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg md:text-xl text-slate-900 font-normal m-0" style={{ fontWeight: 400 }}>
          6. Cambios al Aviso de Privacidad
        </h2>
        <p className="m-0">
          El presente Aviso de Privacidad puede sufrir modificaciones o actualizaciones derivadas de nuevos
          requerimientos legales o mejoras en nuestra plataforma. Cualquier actualización estará siempre
          disponible para su consulta pública en esta misma dirección electrónica.
        </p>
      </section>
    </LegalLayout>
  );
};
