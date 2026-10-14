import { names as sceneNames } from "./ascii-rest/library.js";

export async function initAsciiBanners(
  documentImpl = document,
  loadElement = () => import("./ascii-rest/ascii.js"),
  logger = console,
  random = Math.random
) {
  const sections = Array.from(documentImpl.querySelectorAll('[data-home-section="ascii_banner"]'));
  if (!sections.length) return;

  for (const section of sections) {
    const art = section.querySelector("ascii-art");
    if (!art) continue;
    art.addEventListener("ascii-art-ready", () => {
      section.hidden = false;
    });
    art.addEventListener("ascii-art-error", () => {
      section.hidden = true;
    });
  }

  try {
    for (const section of sections) {
      const art = section.querySelector("ascii-art");
      if (art?.getAttribute("piece") === "random") {
        if (!sceneNames.length) throw new Error("The local ASCII scene catalogue is empty.");
        art.setAttribute("piece", sceneNames[Math.floor(random() * sceneNames.length)]);
      }
    }
    // Install listeners before defining the element, which starts scene loading.
    await loadElement();
    for (const section of sections) {
      if (section.querySelector('ascii-art[data-ascii-ready="true"]')) section.hidden = false;
    }
  } catch (error) {
    for (const section of sections) section.hidden = true;
    logger.warn("Unable to initialise the ASCII banner:", error);
  }
}

if (typeof document !== "undefined") void initAsciiBanners();
