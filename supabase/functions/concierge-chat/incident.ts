// Iato y los incidentes: la lógica vive en _shared/incident-iato.ts (la usa también la evaluación del Operador,
// operador-eval, que no puede importar archivos de la carpeta de otra función). Aquí solo se tipa la herramienta.
import type { ToolDef } from "./toolDefs.ts";
import { REPORT_INCIDENT_TOOL as HERRAMIENTA } from "../_shared/incident-iato.ts";

export * from "../_shared/incident-iato.ts";
export const REPORT_INCIDENT_TOOL: ToolDef = HERRAMIENTA;
