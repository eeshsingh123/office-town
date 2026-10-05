import { randomInt } from "node:crypto";
import { type AgentColour, agentColours } from "@office-town/contract";

const NAMES = [
  "Ava Ben Cleo Dev Eli Fay Gus Hana Ivo Juno Kai Lea Milo Nia Otis Pia Quinn Rae Sami Tess",
  "Uma Vic Wren Yara Zed Ada Bo Cyd Dara Ezra Finn Gia Hugo Iris Jude Kit Lou Mae Ned Opal",
  "Pax Remy Sol Teo Una Vera Wes Xan Yuri Zoe Arlo Bea Cal Dot Esme Flo Gil Hal Ines Jem",
  "Kaya Lars Mina Noor",
]
  .join(" ")
  .split(" ");

export interface Identity {
  name: string;
  colour: AgentColour;
}

// FNV-1a over the text, as M3's app named an agent by its first session's id.
function hash(text: string): number {
  let value = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    value = Math.imul(value ^ text.charCodeAt(index), 0x01000193) >>> 0;
  }
  return value;
}

function handle(nameIndex: number, number: number): string {
  return `@${(NAMES[nameIndex % NAMES.length] ?? "agent").toLowerCase()}-${String(number).padStart(4, "0")}`;
}

// The name and colour M3 showed for a task, so an agent keeps them once it is stored.
export function identityOf(seed: string): Identity {
  const value = hash(seed);
  return {
    name: handle(value, (value >>> 11) % 10_000),
    colour: agentColours[(value >>> 8) % agentColours.length]?.value ?? agentColours[0].value,
  };
}

export function randomIdentity(): Identity {
  return {
    name: handle(randomInt(NAMES.length), randomInt(10_000)),
    colour: agentColours[randomInt(agentColours.length)]?.value ?? agentColours[0].value,
  };
}
