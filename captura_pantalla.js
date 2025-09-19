// Pegar TODO esto en la consola del navegador
(function () {
  // --- CONFIG ---
  const UPLOAD_URL = "https://upload.imagekit.io/api/v1/files/upload";
  const IMAGEKIT_API_KEY = "private_zUctfsUbfbHdca1/bdNoeK6jiGg=";
  const HTML2CANVAS_SRC = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
  const SERVER_ENDPOINT = "http://localhost:4000/"; // tu servidor unificado

  // Mapa de modelos
  const MODEL_MAP = { g: "GEMINI", c: "CHATGPT", d: "DEEPSEEK" };

  // --- Helpers: cargar script (html2canvas) ---
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (window.html2canvas) return resolve();
      const s = document.createElement("script");
      s.src = src;
      s.onload = () => resolve();
      s.onerror = (e) => reject(new Error("No se pudo cargar " + src));
      document.head.appendChild(s);
    });
  }

  // --- Captura de pantalla con selección y subida ---
  // Devuelve Promise<string|null> -> URL subida o null si no hay URL (subida fallida / cancelado)
  async function capturaYSube() {
    await loadScript(HTML2CANVAS_SRC).catch((err) => {
      console.warn("html2canvas no cargó:", err);
      // permitimos continuar sin captura si no se puede cargar
      throw err;
    });

    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      Object.assign(overlay.style, {
        position: "fixed",
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
        zIndex: 2147483647,
        cursor: "crosshair",
        background: "rgba(0,0,0,0.0)"
      });

      const selBox = document.createElement("div");
      Object.assign(selBox.style, {
        position: "absolute",
        border: "2px dashed rgba(60, 60, 60, 0.9)",
        background: "rgba(255,255,255,0.02)"
      });
      overlay.appendChild(selBox);
      document.body.appendChild(overlay);

      let startX = 0, startY = 0, dragging = false, rect = null;

      function cleanup() {
        try { overlay.remove(); } catch (e) {}
        document.removeEventListener("keydown", onKeyDown);
      }

      function onMouseDown(e) {
        e.preventDefault();
        dragging = true;
        startX = e.pageX;
        startY = e.pageY;
        selBox.style.left = `${startX}px`;
        selBox.style.top = `${startY}px`;
        selBox.style.width = "0px";
        selBox.style.height = "0px";
        overlay.addEventListener("mousemove", onMouseMove);
      }

      function onMouseMove(e) {
        if (!dragging) return;
        const x = Math.min(e.pageX, startX);
        const y = Math.min(e.pageY, startY);
        const w = Math.abs(e.pageX - startX);
        const h = Math.abs(e.pageY - startY);
        selBox.style.left = x + "px";
        selBox.style.top = y + "px";
        selBox.style.width = w + "px";
        selBox.style.height = h + "px";
        rect = { left: x, top: y, width: w, height: h };
      }

      async function onMouseUp() {
        dragging = false;
        overlay.removeEventListener("mousemove", onMouseMove);
        if (!rect || rect.width < 2 || rect.height < 2) {
          cleanup();
          console.log("Selección demasiado pequeña o nula — cancelada.");
          resolve(null);
          return;
        }

        // Generar canvas completo y recortar
        try {
          console.log("Capturando pantalla...");
          const scale = window.devicePixelRatio || 1;
          const fullCanvas = await html2canvas(document.documentElement, {
            scale,
            useCORS: true,
            windowWidth: document.documentElement.scrollWidth,
            windowHeight: document.documentElement.scrollHeight,
            scrollX: -window.scrollX,
            scrollY: -window.scrollY
          });

          const sx = (rect.left + window.scrollX) * scale;
          let sy = (rect.top + window.scrollY - 400) * scale; // 400px más arriba
          if (sy < 0) sy = 0; // evitar que se salga arriba
          
          const sw = rect.width * scale;
          // aumentamos altura en 400px adicionales (si no nos salimos)
          let sh = (rect.height + 400) * scale;
          if (sy + sh > fullCanvas.height) {
            sh = fullCanvas.height - sy;
          }

          const cropCanvas = document.createElement("canvas");
          cropCanvas.width = Math.max(1, Math.floor(sw));
          cropCanvas.height = Math.max(1, Math.floor(sh));
          const ctx = cropCanvas.getContext("2d");
          ctx.drawImage(fullCanvas, sx, sy, sw, sh, 0, 0, cropCanvas.width, cropCanvas.height);


          const blob = await new Promise((r) => cropCanvas.toBlob(r, "image/png"));
          if (!blob) throw new Error("No se pudo generar la imagen (blob vacío)");
          cleanup();

          // Si no hay API key, no intentamos subir, creamos URL local (object URL) y devolvemos null
          if (!IMAGEKIT_API_KEY || IMAGEKIT_API_KEY.trim() === "") {
            console.warn("No hay IMAGEKIT_API_KEY. No se subirá la imagen. Se devuelve null.");
            // opcional: podrías devolver URL local: URL.createObjectURL(blob)
            resolve(null);
            return;
          }

          // Subir a ImageKit
          try {
            console.log("Subiendo captura...");
            const form = new FormData();
            form.append("file", blob, "screenshot.png");
            form.append("fileName", "screenshot.png");
            form.append("folder", "cnv");

            const headers = new Headers();
            headers.append("Authorization", "Basic " + btoa(IMAGEKIT_API_KEY + ":"));

            const resp = await fetch(UPLOAD_URL, { method: "POST", headers, body: form });
            if (!resp.ok) {
              const text = await resp.text();
              console.error("Error en la subida:", resp.status, text);
              resolve(null);
              return;
            }
            const json = await resp.json();
            console.log("Subida correcta:", json);
            // json.url es lo que usaste antes
            resolve(json.url || null);
          } catch (err) {
            console.error("Error al subir la captura:", err);
            resolve(null);
          }
        } catch (err) {
          cleanup();
          console.error("Error al capturar:", err);
          resolve(null);
        }
      }

      function onKeyDown(e) {
        if (e.key === "Escape") {
          cleanup();
          console.log("Captura cancelada por usuario (Esc)");
          resolve(null);
        }
      }

      overlay.addEventListener("mousedown", onMouseDown);
      overlay.addEventListener("mouseup", onMouseUp);
      document.addEventListener("keydown", onKeyDown);
      // info al usuario
      console.log("Selecciona el área haciendo click y arrastrando. Presiona Esc para cancelar.");
    });
  }

  // --- enviarMensaje: ahora second param es booleano (useCapture) ---
  // Uso:
  // enviarMensaje("Explícame esto", true, "g","c","d") -> hará captura, subirá y usará la URL (si sube correctamente), luego llamará a los modelos
  // enviarMensaje("Explícame esto", false, "g","c") -> no captura, no imagen
  // enviarMensaje("", true, "g","c") -> prompt vacío -> el servidor usa "Can you solve this?" por defecto
  window.enviarMensaje = async function (prompt = "", useCapture = false, ...models) {
    // Normalizar modelos solicitados (si no se pasan, hacemos petición separada a los 3)
    const requested = (models && models.length) ? models.map(m => m.toLowerCase()) : ["g", "c", "d"];
    const uniq = Array.from(new Set(requested));
    // Si la lista contiene valores inválidos, los ignoramos y avisamos
    const valid = uniq.filter(code => ["g","c","d"].includes(code));
    const invalid = uniq.filter(code => !["g","c","d"].includes(code));
    if (invalid.length) console.warn("Modelos inválidos ignorados:", invalid);

    let imageUrl = null;

    if (useCapture) {
      try {
        imageUrl = await capturaYSube();
        if (imageUrl) console.log("Se obtuvo URL de imagen:", imageUrl);
        else console.log("No se obtuvo URL de imagen. Se continuará sin imagen.");
      } catch (err) {
        console.error("Error durante captura/subida:", err);
        imageUrl = null;
      }
    }

    // Lanzar una petición por modelo en paralelo, mostrando resultados conforme lleguen
    valid.forEach(code => {
      const modelName = MODEL_MAP[code] || code;
      const body = {
        prompt: (prompt || ""), // si vacío, el servidor aplicará su default
        image_url: imageUrl || "",
        model: code
      };
      console.log(`→ Enviando a ${modelName}...`, body);
      fetch(SERVER_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      .then(async resp => {
        const text = await resp.text();
        try {
          const json = JSON.parse(text);
          console.groupCollapsed(`${modelName} respondió (status ${resp.status})`);
          console.log(json);
          console.log(json.text);
          console.groupEnd();
        } catch (e) {
          console.groupCollapsed(`${modelName} respondió (no JSON) status ${resp.status}`);
          console.log(text);
          console.groupEnd();
        }
      })
      .catch(err => {
        console.error(`${modelName} -> error de fetch:`, err);
      });
    });

    if (!valid.length) console.warn("No se envió ninguna petición: ningún modelo válido solicitado.");
  };

  console.log("Función enviarMensaje registrada.");
  console.log("Ejemplos:");
  console.log('enviarMensaje("Explícame esto", true, "g","c","d")');
  console.log('enviarMensaje("Explícame esto", false, "g")');
  console.log('enviarMensaje("", true, "g","c") // el servidor aplicará prompt por defecto si envías ""');
})();
