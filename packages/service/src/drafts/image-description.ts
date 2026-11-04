import { extname } from "node:path";
import {
  type Attachment,
  type HarnessModel,
  MAX_INLINE_IMAGE_BYTES,
  type RoleSettings,
} from "@office-town/contract";
import { z } from "zod";
import type { TeamContext } from "../team/members.ts";
import { askForJson, draftSettings, NATIVE } from "./run.ts";

// The message waits for it, so a slow describer gives way to the path alone.
const WAIT_MS = 90 * 1000;

const descriptionSchema = z.object({ description: z.string().trim().min(1) });

type Context = Pick<TeamContext, "store" | "readCatalog" | "dataFolder" | "createSession">;

type DescribeImages = (
  attachments: readonly Attachment[],
  harness: string,
) => Promise<Attachment[]>;

const seesImages = (model: HarnessModel) => model.inputs?.includes("image") === true;

// As for task titles (D-85): OpenCode's free models first, else the agent's app at its cheapest.
async function describerFor(
  { readCatalog }: Context,
  harness: string,
): Promise<RoleSettings | undefined> {
  const opencode = await readCatalog("opencode", NATIVE).catch(() => undefined);
  const free = opencode?.models.find((model) => model.access === "free" && seesImages(model));
  if (free !== undefined) return draftSettings("opencode", free);
  if (harness === "opencode") return undefined;
  const { models } = await readCatalog(harness, NATIVE);
  // Claude's catalog prices nothing, so its cheapest model is named.
  const cheap =
    models.find((model) => model.access === "free" && seesImages(model)) ??
    models.find((model) => model.id === "haiku" && seesImages(model));
  // With no cheap model that sees images, a paid plan is not spent: the agent gets the path.
  return cheap === undefined ? undefined : draftSettings(harness, cheap);
}

const PROMPT = [
  "Describe the attached image for a colleague who cannot see it and must work from your words alone.",
  "- Say what it is (screenshot, photo, diagram, chart, design, document), then its layout from top to bottom.",
  "- Copy every piece of visible text exactly, in reading order.",
  "- Name the details someone would act on: controls and their state, errors, numbers, chart values, colours, positions.",
  "- Only what is visible: no guesses and no advice.",
  'Reply with this JSON object only, using \\n for line breaks: {"description": "..."}',
].join("\n");

function fileText(image: Attachment, describer: RoleSettings, description: string): string {
  return [
    `# ${image.name}, described`,
    "",
    `Written by ${describer.model} for a model that cannot see images. Only what was visible is here.`,
    "",
    description,
    "",
  ].join("\n");
}

function withinWait<T>(work: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("The description took too long.")), WAIT_MS);
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

// One description per image, kept for as long as its file is; a failure leaves the path alone.
export function imageDescriber(context: Context): DescribeImages {
  const described = new Map<string, Promise<Attachment | undefined>>();

  const describe = async (image: Attachment, describer: RoleSettings) => {
    const { description } = await withinWait(
      askForJson(context, describer, PROMPT, descriptionSchema, [], [{ ...image, inline: true }]),
    );
    const stem = image.name.slice(0, image.name.length - extname(image.name).length);
    return context.store.saveFile({
      kind: "file",
      name: `${stem} description.md`,
      mimeType: "text/markdown",
      content: Buffer.from(fileText(image, describer, description)),
    });
  };

  const descriptionOf = async (image: Attachment, describer: RoleSettings) => {
    const pending = described.get(image.id);
    if (pending !== undefined) {
      const known = await pending;
      // Its file went with a deleted task, so the image is described again.
      if (known === undefined || context.store.getAttachment(known.id) !== undefined) return known;
    }
    const fresh = describe(image, describer).catch((error: unknown) => {
      console.error(`Could not describe image ${image.name}.`, error);
      described.delete(image.id);
      return undefined;
    });
    described.set(image.id, fresh);
    return fresh;
  };

  return async (attachments, harness) => {
    const images = attachments.filter(
      (attachment) =>
        attachment.kind === "image" &&
        (attachment.bytes ?? Number.POSITIVE_INFINITY) <= MAX_INLINE_IMAGE_BYTES,
    );
    if (images.length === 0) return [];
    const describer = await describerFor(context, harness).catch(() => undefined);
    if (describer === undefined) return [];
    const found = await Promise.all(images.map((image) => descriptionOf(image, describer)));
    return found.filter((one) => one !== undefined);
  };
}
