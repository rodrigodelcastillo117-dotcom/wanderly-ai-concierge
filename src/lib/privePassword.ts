// Guía de fuerza de la contraseña Privé (decisión D5 del contrato: 12–72 bytes, bcrypt en el
// servidor, y el servidor también la compara con filtraciones conocidas). Esta guía solo ayuda a
// elegir bien: la decisión final la toma el servidor (PASSWORD_WEAK / PASSWORD_BREACHED).

export const PRIVE_PW_MIN = 12;
/** bcrypt usa como máximo 72 bytes; más allá se ignoraría en silencio, por eso se limita. */
export const PRIVE_PW_MAX = 72;

export const byteLength = (s: string) => new TextEncoder().encode(s).length;

const SEQUENCES = ["0123456789", "abcdefghijklmnopqrstuvwxyz", "qwertyuiop", "asdfghjkl", "zxcvbnm"];
const COMMON = ["password", "contrasena", "contraseña", "iatos", "prive", "privé", "qwerty", "123456", "admin", "welcome", "bienvenido"];

export type PasswordRule = { id: string; label: string; ok: boolean };
export type PasswordCheck = {
  bytes: number;
  rules: PasswordRule[];
  /** 0 (muy débil) … 4 (excelente). */
  score: number;
  label: string;
  /** Todas las reglas obligatorias cumplidas y fuerza al menos "Aceptable". */
  acceptable: boolean;
};

function isSequential(lower: string): boolean {
  const compact = lower.replace(/\s+/g, "");
  if (compact.length < 6) return false;
  return SEQUENCES.some((seq) => {
    const rev = [...seq].reverse().join("");
    for (let i = 0; i + 6 <= compact.length; i++) {
      const chunk = compact.slice(i, i + 6);
      if (seq.includes(chunk) || rev.includes(chunk)) return true;
    }
    return false;
  });
}

const LABELS = ["Muy débil", "Débil", "Aceptable", "Fuerte", "Excelente"];

export function checkPrivePassword(pw: string, confirm?: string): PasswordCheck {
  const bytes = byteLength(pw);
  const lower = pw.toLocaleLowerCase("es-MX");
  const unique = new Set([...pw]).size;
  const classes = [/[a-záéíóúñü]/, /[A-ZÁÉÍÓÚÑÜ]/, /\d/, /[^\p{L}\d\s]/u, /\s/].filter((r) => r.test(pw)).length;
  const words = pw.trim().split(/\s+/).filter((w) => w.length >= 3).length;

  const lengthOk = bytes >= PRIVE_PW_MIN && bytes <= PRIVE_PW_MAX;
  const variedOk = pw.length === 0 ? false : unique >= Math.min(6, Math.ceil(pw.length / 3));
  const sequenceOk = pw.length > 0 && !isSequential(lower);
  const commonOk = pw.length > 0 && !COMMON.some((c) => lower.replace(/\s+/g, "") === c || (lower.includes(c) && bytes < 20));

  const rules: PasswordRule[] = [
    { id: "length", label: `Entre ${PRIVE_PW_MIN} y ${PRIVE_PW_MAX} caracteres`, ok: lengthOk },
    { id: "varied", label: "Sin repetir el mismo carácter una y otra vez", ok: variedOk },
    { id: "sequence", label: "Sin secuencias como 123456 o qwerty", ok: sequenceOk },
    { id: "common", label: "Sin palabras obvias como «password», «iatos» o «privé»", ok: commonOk },
  ];
  if (confirm !== undefined) rules.push({ id: "match", label: "Las dos contraseñas coinciden", ok: pw.length > 0 && pw === confirm });

  let score = 0;
  if (bytes >= PRIVE_PW_MIN) score = 1;
  if (bytes >= 14 && classes >= 2) score = 2;
  if (bytes >= 16 && (classes >= 3 || words >= 3)) score = 3;
  if (bytes >= 20 && (classes >= 3 || words >= 4)) score = 4;
  // Una frase de 4 palabras o más es fuerte aunque sea solo de minúsculas.
  if (words >= 4 && bytes >= 20) score = Math.max(score, 3);
  if (!variedOk || !sequenceOk || !commonOk) score = Math.min(score, 1);
  if (bytes > PRIVE_PW_MAX) score = Math.min(score, 1);

  const mandatoryOk = rules.every((r) => r.ok);
  return { bytes, rules, score, label: LABELS[score], acceptable: mandatoryOk && score >= 2 };
}
