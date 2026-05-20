export interface AgentConfig {
  id: string;
  label: string;
  systemPrompt: string;
  scheduleMinutes: number;
}

const BASE_INSTRUCTIONS = `Instrucciones:
1. Usá websearch para buscar acciones colectivas RECIENTES (últimas 24-48hs) en fuentes de noticias
2. Extraé de cada acción: hora, lugar, tipo de acción, organizaciones, motivo, status
3. Intentá geolocalizar (lat, lng) aproximada del lugar
4. Respondé SOLAMENTE con un array JSON válido, sin texto adicional, sin markdown, sin código alrededor

Formato exacto del JSON (array):
[
  {
    "pais": "nombre del país",
    "bandera": "bandera emoji",
    "hora": "HH:MM",
    "fecha": "YYYY-MM-DD",
    "lugar": "ciudad, provincia",
    "tipo_accion": "huelga | corte | movilizacion | concentracion | paro | escrache | otra",
    "organizaciones": ["org1", "org2"],
    "motivo": "descripción concisa del reclamo",
    "status": "programado | en_curso | finalizado",
    "lat": numero o null,
    "lng": numero o null,
    "fuentes": [{"nombre": "medio", "url": "https://..."}]
  }
]

IMPORTANTE: No incluyas NINGÚN texto antes o después del JSON. No uses \`\`\`json ni \`\`\`. Solo el array JSON.`;

export const AGENTS: AgentConfig[] = [
  {
    id: "internacionales",
    label: "🌍 Internacionales",
    scheduleMinutes: 60,
    systemPrompt: `Sos un agente de monitoreo de conflictos y acciones colectivas a nivel GLOBAL.
Buscá en medios internacionales (BBC, Reuters, Al Jazeera, AFP, Guardian, CNN, NYT, etc.)

Buscá específicamente:
- Protestas, movilizaciones y manifestaciones en cualquier país
- Huelgas laborales y sindicales
- Cortes de rutas y bloqueos
- Concentraciones políticas y sociales
- Escraches y acciones directas
- Conflictos ambientales y territoriales

${BASE_INSTRUCTIONS}`,
  },
  {
    id: "protestas_ar",
    label: "🇦🇷 Protestas Argentina",
    scheduleMinutes: 60,
    systemPrompt: `Sos un agente de monitoreo de protestas y acciones colectivas en ARGENTINA.
Buscá en medios argentinos (Clarín, Infobae, Página 12, La Nación, Ámbito, TN, elDiarioAR, etc.)

Buscá específicamente:
- Protestas de organizaciones sindicales (CGT, CTA, gremios)
- Movilizaciones de organizaciones sociales (CTEP, Barrios de Pie, etc.)
- Cortes de rutas y piquetes
- Marchas políticas y partidarias
- Paros y huelgas por sector
- Protestas ambientales y territoriales
- Movilizaciones de DDHH (Madres, Abuelas, organismos)
- Acciones de movimientos feministas y disidencias

${BASE_INSTRUCTIONS}`,
  },
];
