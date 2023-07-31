import { addJSDoc } from "./addJSDoc.ts";
import { CommandParameter, Domain, getProtocol } from "./getProtocol.ts";

// 1. Get current protocol version
const protocol = await getProtocol();

// 2. Generate boilerplate at the top
let types =
  "// These bindings are auto-generated by ./_tools/generate/mod.ts\n";
types += `// Last generated at ${new Date().toISOString()}\n`;
types += "// deno-lint-ignore-file no-explicit-any\n\n";
types +=
  `export const PROTOCOL_VERSION = "${protocol.version.major}.${protocol.version.minor}";\n\n`;

// 3. Generate actual bindings

function nameToType(
  name:
    | "string"
    | "integer"
    | "number"
    | "boolean"
    | "binary"
    | "any"
    | "object",
) {
  if (name === "binary") {
    return "string";
  } else if (name === "integer") {
    return "number";
  } else {
    return name;
  }
}

function generateTypes(domain: Domain) {
  for (const type of domain.types ?? []) {
    types += addJSDoc(type);
    types += `export type ${domain.domain}_${type.id} = `;

    if (type.type === "integer" || type.type === "number") {
      types += "number";
    } else if (type.type === "string") {
      if (type.enum) {
        types += (type.enum as string[]).map((str) => `"${str}"`).join(" | ");
      } else {
        types += "string";
      }
    } else if (type.type === "object") {
      if (type.properties) {
        types += "{\n";
        for (const property of type.properties) {
          types += addJSDoc(property);
          types += `\t${property.name}`;
          types += property.optional ? "?: " : ": ";
          if ("$ref" in property) {
            if (property.$ref.includes(".")) {
              types += property.$ref.replaceAll(".", "_");
            } else {
              types += `${domain.domain}_${property.$ref}`;
            }
          } else {
            if (property.type === "string") {
              if (property.enum) {
                types += (property.enum as string[]).map((str) => `"${str}"`)
                  .join(" | ");
              } else {
                types += "string";
              }
            } else if (property.type === "array") {
              if ("type" in property.items) {
                types += `${nameToType(property.items.type)}[]`;
              } else {
                if (property.items.$ref.includes(".")) {
                  types += property.items.$ref.replaceAll(".", "_") + "[]";
                } else {
                  types += `${domain.domain}_${property.items.$ref}[]`;
                }
              }
            } else {
              types += nameToType(property.type);
            }
          }
          types += ";\n";
        }
        types += "}";
      } else {
        types += "object";
      }
    } else if (type.type === "array") {
      if ("type" in type.items) {
        types += `${nameToType(type.items.type)}[]`;
      } else {
        if (type.items.$ref.includes(".")) {
          types += type.items.$ref.replaceAll(".", "_") + "[]";
        } else {
          types += `${domain.domain}_${type.items.$ref}[]`;
        }
      }
    }

    types += ";\n\n";
  }
}

function generateParameters(commandParams: CommandParameter[], domain: string) {
  return commandParams.map((param) => {
    let p = addJSDoc(param);
    p += param.name;
    p += param.optional ? "?: " : ":";
    if ("$ref" in param) {
      if (param.$ref.includes(".")) {
        p += param.$ref.replaceAll(".", "_");
      } else {
        p += `${domain}_${param.$ref}`;
      }
    } else {
      if (param.type === "array") {
        if ("type" in param.items) {
          p += `${nameToType(param.items.type)}[]`;
        } else {
          if (param.items.$ref.includes(".")) {
            p += param.items.$ref.replaceAll(".", "_") + "[]";
          } else {
            p += `${domain}_${param.items.$ref}[]`;
          }
        }
      } else if (param.type === "string") {
        if (param.enum) {
          p += (param.enum as string[]).map((str) => `"${str}"`)
            .join(" | ");
        } else {
          p += "string";
        }
      } else {
        p += nameToType(param.type);
      }
    }
    return p;
  }).join(", \n");
}

let events = "";
let eventMap = "const CelestialEvents = {\n";
let eventMapType = "\ninterface CelestialEventMap {";

let celestial = `
export class Celestial extends EventTarget {
  #ws: WebSocket;
  #id = 0;
  #handlers: Map<number, (value: unknown) => void> = new Map();

  /**
   * Celestial expects a open websocket to communicate over
   */
  constructor(ws: WebSocket) {
    super();

    this.#ws = ws;

    this.#ws.onmessage = (e) => {
      const data = JSON.parse(e.data);

      const handler = this.#handlers.get(data.id);

      if(handler) {
        handler(data.result);
        this.#handlers.delete(data.id);
      } else {
        const className = CelestialEvents[data.method.replaceAll(".", "_") as keyof CelestialEventMap];
        if(data.params) {
          this.dispatchEvent(new className(data.params))
        } else {
          // @ts-ignore trust me
          this.dispatchEvent(new className())
        }
      }
    };
  }

  // @ts-ignore everything is fine
  addEventListener<K extends keyof CelestialEventMap>(type: K, listener: (this: Celestial, ev: CelestialEventMap[K]) => any, options?: boolean | AddEventListenerOptions): void {
    // @ts-ignore and I am calm.
    super.addEventListener(type, listener, options);
  }

  #sendReq(method: string, params?: unknown): Promise<any> {
    this.#ws.send(JSON.stringify({
      id: ++this.#id,
      method,
      params
    }))

    return new Promise((res)=>{
      this.#handlers.set(this.#id, res)
    })
  }
`;

for (const domain of protocol.domains) {
  types += `// ----------------- ${domain.domain} Types -----------------\n\n`;
  generateTypes(domain);

  celestial += addJSDoc(domain);
  celestial += `${domain.domain} = {\n`;

  for (const command of domain.commands || []) {
    celestial += addJSDoc(command);
    celestial += `\n${command.name} = async (`;
    if (command.parameters) {
      celestial += `opts: {${
        generateParameters(command.parameters, domain.domain)
      }}`;
    }
    celestial += "): Promise<";
    if (command.returns) {
      celestial += `{${generateParameters(command.returns, domain.domain)}}`;
    } else {
      celestial += "void";
    }
    celestial += "> => {\n";
    if (command.parameters) {
      celestial +=
        `return await this.#sendReq("${domain.domain}.${command.name}", opts)`;
    } else {
      celestial +=
        `return await this.#sendReq("${domain.domain}.${command.name}")`;
    }
    celestial += `},\n\n`;
  }
  celestial += "}\n\n";

  for (const event of domain.events || []) {
    if (event.parameters) {
      events += `
      interface ${domain.domain}_${event.name} {
        ${generateParameters(event.parameters, domain.domain)}
      }

      class ${domain.domain}_${event.name}Event extends CustomEvent<${domain.domain}_${event.name}> {
        constructor(detail: ${domain.domain}_${event.name}) {
          super("${domain.domain}_${event.name}", { detail })
        }
      }\n\n`;
      eventMap +=
        `\t"${domain.domain}_${event.name}": ${domain.domain}_${event.name}Event,\n`;
      eventMapType +=
        `\t"${domain.domain}_${event.name}": ${domain.domain}_${event.name}Event;\n`;
    } else {
      eventMap += `\t"${domain.domain}_${event.name}": Event,\n`;
      eventMapType += `\t"${domain.domain}_${event.name}": Event;\n`;
    }
  }
}

celestial += "}\n";
eventMap += "}\n";
eventMapType += "}\n";

// 4. Write data to ./bindings/celestial.ts
Deno.writeTextFileSync(
  "./bindings/celestial.ts",
  types + events + eventMap + eventMapType + celestial,
);