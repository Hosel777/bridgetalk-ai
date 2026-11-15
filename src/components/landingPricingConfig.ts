export const PRICING_CONFIG = {
  trial: {
    name: 'Prueba gratuita',
    priceUsd: 0,
    durationMinutes: 15,
    cadence: 'sin tarjeta',
    description: 'Prueba una entrevista real antes de decidir.',
    action: 'Comenzar Prueba Gratuita',
  },
  pro: {
    name: 'BridgeTalk Pro',
    priceUsd: 29,
    monthlyInterpretationHours: 15,
    cadence: 'USD / mes',
    description: 'Todo lo necesario para comunicarte con seguridad.',
    action: 'Suscribirme a BridgeTalk Pro',
  },
} as const;

export const PRICING_FEATURES = {
  trial: [
    `${PRICING_CONFIG.trial.durationMinutes} minutos de entrevista simulada en vivo`,
    'Prueba la baja latencia y genera tu Sello de Confianza',
    'Sin tarjeta de crédito',
  ],
  pro: [
    `Hasta ${PRICING_CONFIG.pro.monthlyInterpretationHours} horas/mes de interpretación en vivo, bajo política de uso justo`,
    'Traducción contextual con CV y descripción de vacante',
    'Enrutamiento de audio virtual',
    'Sello de Confianza para presentarte al reclutador',
    'Índice de Independencia del Idioma verificable',
    'Módulo de aprendizaje activo con flashcards ilimitadas',
  ],
} as const;
