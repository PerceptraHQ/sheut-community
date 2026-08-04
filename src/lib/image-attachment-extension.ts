import { Node } from "@tiptap/core";
import { loadDocumentImage } from "./documents";
import { loadEvidenceImage } from "./evidence";

export function createImageAttachmentExtension(projectId: string, documentId: string) {
  return createEncryptedImageExtension(
    "imageAttachment",
    "attachmentId",
    "data-sheut-image-attachment",
    (attachmentId) => loadDocumentImage(projectId, documentId, attachmentId),
  );
}

export function createEvidenceImageExtension(projectId: string) {
  return createEncryptedImageExtension(
    "evidenceImage",
    "evidenceId",
    "data-sheut-evidence-image",
    (evidenceId) => loadEvidenceImage(projectId, evidenceId),
  );
}

function createEncryptedImageExtension(
  name: string,
  idAttribute: "attachmentId" | "evidenceId",
  dataAttribute: string,
  load: (id: string) => Promise<ArrayBuffer>,
) {
  return Node.create({
    name,
    group: "block",
    atom: true,
    draggable: false,

    addAttributes() {
      return {
        [idAttribute]: { default: null },
        alt: { default: "Attached image" },
        title: { default: null },
        ...(idAttribute === "evidenceId"
          ? {
              placement: { default: "inline" },
              appendixKey: { default: null },
              appendixTitle: { default: null },
            }
          : {}),
      };
    },

    parseHTML() {
      return [{ tag: `figure[${dataAttribute}]` }];
    },

    renderHTML({ HTMLAttributes }) {
      const attributes: unknown = HTMLAttributes;
      const id = stringAttribute(attributes, idAttribute, "");
      const alt = stringAttribute(attributes, "alt", "Attached image");
      return [
        "figure",
        {
          [dataAttribute]: id,
        },
        ["figcaption", {}, alt],
      ];
    },

    addNodeView() {
      return ({ node }) => {
        const attributes: unknown = node.attrs;
        const id = stringAttribute(attributes, idAttribute, "");
        const alt = stringAttribute(attributes, "alt", "Attached image");
        const figure = window.document.createElement("figure");
        const image = window.document.createElement("img");
        const caption = window.document.createElement("figcaption");
        const status = window.document.createElement("span");
        let objectUrl: string | null = null;
        let destroyed = false;

        figure.className = "editor-image-attachment";
        figure.dataset.evidenceReference = id;
        figure.contentEditable = "false";
        image.alt = alt;
        image.draggable = false;
        caption.textContent = alt;
        status.className = "editor-image-status";
        status.textContent = "Decrypting image…";
        figure.append(status, image, caption);

        void load(id)
          .then((bytes) => {
            if (destroyed) return;
            objectUrl = URL.createObjectURL(new Blob([bytes]));
            image.addEventListener(
              "load",
              () => {
                status.remove();
              },
              { once: true },
            );
            image.addEventListener(
              "error",
              () => {
                status.textContent = "Image could not be decoded.";
              },
              { once: true },
            );
            image.src = objectUrl;
          })
          .catch(() => {
            if (!destroyed) status.textContent = "Image is unavailable.";
          });

        return {
          dom: figure,
          update: () => false,
          destroy: () => {
            destroyed = true;
            if (objectUrl) URL.revokeObjectURL(objectUrl);
          },
        };
      };
    },
  });
}

function stringAttribute(attributes: unknown, name: string, fallback: string): string {
  if (typeof attributes !== "object" || attributes === null) return fallback;
  const value: unknown = Reflect.get(attributes, name);
  return typeof value === "string" ? value : fallback;
}
