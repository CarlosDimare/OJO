export interface AgentConfig {
  id: string;
  label: string;
  systemPrompt: string;
  scheduleMinutes: number;
}

const BASE_INSTRUCTIONS = `Instrucciones ESTRICTAS:

1. NO escribas archivos ni uses la herramienta bash para guardar nada.
2. NO expliques ni resumas. NO uses markdown.
3. Buscá con websearch acciones colectivas que estén OCURRIENDO HOY en todo el mundo.
4. Respondé ÚNICA Y EXCLUSIVAMENTE con un array JSON. NADA MÁS. Ni una palabra, ni markdown, ni código, ni explicación.

Formato exacto del JSON (array):
[
  {
    "pais": "nombre del país",
    "bandera": "bandera emoji",
    "hora": "HH:MM",
    "fecha": "2026-05-20 (debe ser HOY)",
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

REGLAS DE ORO:
- SOLO JSON. Sin texto, sin markdown, sin \`\`\`json.
- Si no encontrás acciones de HOY, respondé SOLAMENTE: []
- No guardes archivos. No escribas resúmenes. No expliques.
- Tu respuesta completa debe ser parseable con JSON.parse().`;

export const AGENTS: AgentConfig[] = [
  {
    id: "internacionales",
    label: "🌍 Internacionales",
    scheduleMinutes: 30,
    systemPrompt: `Sos un agente de monitoreo de conflictos y acciones colectivas a nivel GLOBAL (EXCLUYENDO ARGENTINA).
Buscá en medios internacionales (BBC, Reuters, Al Jazeera, AFP, Guardian, CNN, NYT, etc.)
NO incluyas acciones de Argentina. Esas van en otra sección.

Buscá específicamente acciones de HOY en el resto del mundo:
- Protestas, movilizaciones y manifestaciones
- Huelgas laborales y sindicales
- Cortes de rutas y bloqueos
- Concentraciones políticas y sociales

${BASE_INSTRUCTIONS}`,
  },
  {
    id: "protestas_ar",
    label: "🇦🇷 Protestas Argentina",
    scheduleMinutes: 30,
    systemPrompt: `Sos un agente de monitoreo de protestas y acciones colectivas en ARGENTINA.
Buscá en medios argentinos (Clarín, Infobae, Página 12, La Nación, Ámbito, TN, elDiarioAR, etc.)

Buscá específicamente acciones de HOY:
- Protestas sindicales (CGT, CTA, gremios)
- Movilizaciones sociales
- Cortes de ruta y piquetes
- Marchas políticas
- Paros y huelgas

${BASE_INSTRUCTIONS}`,
  },
];
