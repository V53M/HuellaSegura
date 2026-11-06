// Política de tratamiento de datos que el adoptante autoriza (Ley 1581 de 2012).
// BORRADOR: el texto definitivo lo deben revisar la fundación y el director antes del piloto.
// Al cambiar el texto hay que subir la versión: los consentimientos guardan la versión que se aceptó.
export const POLITICA = {
  version: process.env.POLITICA_VERSION ?? '2027-01-borrador',
  resumen: [
    'La fundación de origen y el equipo de HuellaSegura tratan sus datos de contacto y la ubicación del collar de su animal.',
    'La finalidad es el seguimiento posadopción y la detección temprana de pérdida o abandono, en el marco de las leyes 1774 de 2016 y 2054 de 2020.',
    'Solo el personal autorizado de la fundación ve la ubicación. El sistema no declara abandono: genera evidencia para que la fundación decida.',
    'Puede consultar, corregir o pedir la supresión de sus datos, y revocar esta autorización en cualquier momento desde la app o con la fundación. Al revocarla, el seguimiento se detiene.',
  ],
};
