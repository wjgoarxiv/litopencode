// A stand-in for the OpenCode 2 server plugin context. It records every transform, hook and session
// call the plugin makes, so a test can replay them the way the host does: transforms run against an
// editor, hooks receive a mutable event object.
const registration = () => ({ dispose: async () => undefined });

/** The two host agents LitOpenCode hides, with the defaults OpenCode 2 gives every agent. */
export function hostAgent(id, mode = "primary") {
  return {
    id,
    name: id,
    request: { settings: {}, headers: {}, body: {} },
    mode,
    hidden: false,
    permissions: [
      { action: "*", resource: "*", effect: "allow" },
      { action: "read", resource: "*.env", effect: "ask" },
      { action: "read", resource: "*.env.*", effect: "ask" },
      { action: "read", resource: "*.env.example", effect: "allow" }
    ]
  };
}

export function createAgentEditor(seed = [hostAgent("build"), hostAgent("plan"), hostAgent("general", "subagent")]) {
  const agents = new Map(seed.map((agent) => [agent.id, structuredClone(agent)]));
  let defaultAgent;
  return {
    agents,
    defaultAgent: () => defaultAgent,
    list: () => [...agents.values()],
    get: (id) => agents.get(id),
    default: (id) => {
      defaultAgent = id;
    },
    update: (id, update) => {
      const agent = agents.get(id) ?? hostAgent(id);
      update(agent);
      agents.set(id, agent);
    },
    remove: (id) => agents.delete(id)
  };
}

export function createToolEditor() {
  const tools = new Map();
  return {
    tools,
    list: () => [...tools.entries()].map(([id, tool]) => ({ ...tool, id })),
    get: (id) => tools.get(id),
    namespace: () => undefined,
    add: (tool) => tools.set(tool.name, tool),
    update: (id, update) => {
      const tool = tools.get(id);
      if (tool !== undefined) update(tool);
    },
    remove: (id) => tools.delete(id)
  };
}

/** The provider catalog a model transform edits; a model the provider lacks is created on update. */
export function createModelEditor(catalog = { openai: [] }) {
  const providers = new Map(Object.entries(catalog).map(([providerID, models]) => [providerID, new Map(models.map((model) => [model.id, structuredClone(model)]))]));
  return {
    providers,
    list: (providerID) => [...(providerID === undefined ? [...providers.values()] : [providers.get(providerID) ?? new Map()])].flatMap((models) => [...models.values()]),
    get: (providerID, modelID) => providers.get(providerID)?.get(modelID),
    update: (providerID, modelID, update) => {
      const models = providers.get(providerID);
      if (models === undefined) return;
      const model = models.get(modelID) ?? { id: modelID, providerID, variants: [] };
      update(model);
      model.id = modelID;
      model.providerID = providerID;
      models.set(modelID, model);
    },
    remove: (providerID, modelID) => providers.get(providerID)?.delete(modelID)
  };
}

export function createCommandEditor() {
  const commands = [];
  return { commands, add: (definition) => commands.push(definition) };
}

function eventQueue() {
  const pending = [];
  let wake;
  const iterable = (signal) => ({
    async *[Symbol.asyncIterator]() {
      while (!signal?.aborted) {
        if (pending.length > 0) {
          yield pending.shift();
          continue;
        }
        await new Promise((resolve) => {
          wake = resolve;
          signal?.addEventListener("abort", resolve, { once: true });
        });
      }
    }
  });
  return {
    iterable,
    push(event) {
      pending.push(event);
      wake?.();
    }
  };
}

export function createFakeV2Context(options = {}) {
  const directory = options.directory ?? process.cwd();
  const transforms = { agent: [], tool: [], command: [], model: [], skill: [] };
  const hooks = new Map();
  const prompts = [];
  const compactions = [];
  // Every session call in order, so a test can check that an agent switch comes before its prompt.
  const sessionCalls = [];
  const sessions = new Map(Object.entries(options.sessions ?? {}));
  const events = eventQueue();
  let subscriptions = 0;
  let aborted = 0;
  const hook = (domain) => async (name, callback) => {
    const key = `${domain}.${name}`;
    hooks.set(key, [...(hooks.get(key) ?? []), callback]);
    return registration();
  };
  const transform = (domain) => async (callback) => {
    transforms[domain].push(callback);
    return registration();
  };
  const context = {
    app: { version: "2.0.32", channel: "latest" },
    location: { directory, project: { id: "prj_test", directory, canonical: directory } },
    options: {},
    agent: { transform: transform("agent"), reload: async () => undefined },
    tool: { transform: transform("tool"), reload: async () => undefined, list: async () => [], hook: hook("tool") },
    command: { transform: transform("command"), reload: async () => undefined, list: async () => [] },
    model: { transform: transform("model"), reload: async () => undefined, list: async () => options.models ?? [] },
    skill: { transform: transform("skill"), reload: async () => undefined },
    permission: { hook: hook("permission") },
    session: {
      hook: hook("session"),
      get: async ({ sessionID }) => {
        const session = sessions.get(sessionID);
        if (session === undefined) throw new Error(`no session ${sessionID}`);
        return session;
      },
      switchModel: async (input) => {
        sessionCalls.push({ call: "switchModel", ...input });
        const session = sessions.get(input.sessionID);
        if (session !== undefined) session.model = input.model;
      },
      switchAgent: async (input) => {
        sessionCalls.push({ call: "switchAgent", ...input });
        const session = sessions.get(input.sessionID);
        if (session !== undefined) session.agent = input.agent;
      },
      prompt: async (input) => {
        sessionCalls.push({ call: "prompt", sessionID: input.sessionID });
        prompts.push(input);
        return { id: `inb_${prompts.length}` };
      },
      compact: async (input) => {
        compactions.push(input);
        return { id: `inb_compact_${compactions.length}` };
      }
    },
    event: {
      subscribe: (subscribeOptions = {}) => {
        subscriptions += 1;
        subscribeOptions.signal?.addEventListener("abort", () => {
          aborted += 1;
        }, { once: true });
        return events.iterable(subscribeOptions.signal);
      }
    }
  };

  async function run(domain, name, input) {
    for (const callback of hooks.get(`${domain}.${name}`) ?? []) await callback(input);
    return input;
  }

  return {
    context,
    transforms,
    hooks,
    prompts,
    compactions,
    sessionCalls,
    sessions,
    emit: (event) => events.push(event),
    subscriptions: () => subscriptions,
    aborted: () => aborted,
    run,
    applyAgents(editor = createAgentEditor()) {
      for (const callback of transforms.agent) callback(editor);
      return editor;
    },
    applyTools(editor = createToolEditor()) {
      for (const callback of transforms.tool) callback(editor);
      return editor;
    },
    applyModels(editor = createModelEditor()) {
      for (const callback of transforms.model) callback(editor);
      return editor;
    },
    applyCommands(editor = createCommandEditor()) {
      for (const callback of transforms.command) callback(editor);
      return editor;
    }
  };
}

/**
 * Waits until `done()` holds, or fails after `timeoutMs`. For work that ends in real file I/O: a fixed
 * number of `settle` turns finishes in well under a millisecond, which a slower disk outlasts.
 */
export async function until(done, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (!done()) {
    if (Date.now() >= deadline) throw new Error("timed out waiting for the event subscriber");
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}

/** Lets queued microtasks and event-loop turns settle so an event subscriber can act. */
export async function settle(turns = 5) {
  for (let index = 0; index < turns; index += 1) await new Promise((resolve) => setImmediate(resolve));
}
