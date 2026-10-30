// Reloj fijo para la evaluación del Operador en el servidor (operador-eval): durante un escenario, `new Date()` y
// `Date.now()` devuelven la hora del escenario (lo mismo que hace el reloj falso de Vitest en las pruebas), así las
// reglas de horario del proveedor, plazos y seguimientos se califican igual que en la evaluación local. Solo lo usa
// operador-eval, que corre UNA evaluación a la vez y siempre lo suelta al terminar (finally). Puro.
const DateReal = globalThis.Date;

export type Reloj = { fijar: (inicio: Date) => void; soltar: () => void };

export function relojFijo(): Reloj {
  return {
    fijar(inicio: Date) {
      const t = DateReal.prototype.getTime.call(inicio);
      class DateFijo extends DateReal {
        // deno-lint-ignore no-explicit-any
        constructor(...a: any[]) {
          // @ts-ignore -- mismos argumentos que Date
          if (a.length === 0) super(t); else super(...a);
        }
        static override now() { return t; }
      }
      globalThis.Date = DateFijo as DateConstructor;
    },
    soltar() { globalThis.Date = DateReal; },
  };
}
