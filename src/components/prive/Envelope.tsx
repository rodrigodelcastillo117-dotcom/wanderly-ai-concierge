import { motion } from "framer-motion";
import { Monogram } from "@/components/prive/Monogram";
import { EASE } from "@/components/prive/motion";

/**
 * Sobre digital: cuerpo con pliegues, solapa en 3D, sello de cera dorado y un reflejo que cruza una
 * vez. Todo CSS/SVG. `open` abre la solapa y sube la carta. Con `reduce`, sin giros ni desplazamientos.
 */
export function Envelope({ open, reduce, waiting = false, children }: {
  open: boolean;
  reduce: boolean;
  /** Esperando al servidor: un pulso muy tenue del sello. */
  waiting?: boolean;
  /** Contenido de la carta (se ve al abrir). */
  children?: React.ReactNode;
}) {
  const t = (d: number, delay = 0) => (reduce ? { duration: 0.08 } : { duration: d, delay, ease: EASE });
  return (
    <div className="prive-envelope" data-open={open} data-testid="prive-envelope">
      <div className="prive-envelope-body">
        {!reduce && (
          <motion.div
            className="prive-envelope-sheen"
            aria-hidden="true"
            initial={{ x: "-60%" }}
            animate={{ x: "60%" }}
            transition={{ duration: 2.6, delay: 0.6, ease: EASE }}
          />
        )}
      </div>
      <motion.div
        className="prive-letter"
        initial={false}
        animate={reduce ? { opacity: open ? 1 : 0 } : { y: open ? "-38%" : "0%", opacity: open ? 1 : 0 }}
        transition={t(1.1, open ? 0.45 : 0)}
        style={{ zIndex: open ? 5 : 2 }}
        aria-hidden={!open}
      >
        {children}
      </motion.div>
      <motion.div
        className="prive-envelope-flap"
        aria-hidden="true"
        initial={false}
        animate={reduce ? { opacity: open ? 0 : 1 } : { rotateX: open ? 178 : 0 }}
        transition={t(0.9)}
        style={{ zIndex: open ? 1 : 3 }}
      />
      <div className="prive-seal-pos" aria-hidden="true">
      <motion.div
        className="prive-seal"
        aria-hidden="true"
        initial={false}
        animate={
          reduce
            ? { opacity: open ? 0 : 1 }
            : open
              ? { opacity: 0, scale: 0.85 }
              : waiting
                ? { opacity: [1, 0.75, 1], scale: 1 }
                : { opacity: 1, scale: 1 }
        }
        transition={waiting && !open && !reduce ? { duration: 1.4, repeat: Infinity, ease: "easeInOut" } : t(0.5)}
      >
        <Monogram size={44} ink="#3a2c12" />
      </motion.div>
      </div>
    </div>
  );
}
