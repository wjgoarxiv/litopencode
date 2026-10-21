// LitOpenCode's OpenCode 2 server plugin. OpenCode 2 runs one instance per project location and calls
// `setup` once for it; every registration below is released by the host when the instance stops, and
// the returned cleanup releases what the plugin itself holds. There is no automatic self-update here:
// OpenCode 2 updates plugins itself (`opencode plugin update` and its update policy).
import path from "node:path";
import { loadConfig } from "../config.ts";
import { createDeliverableHedgeGuard } from "../deliverable-hedge-guard.ts";
import { createLogger } from "../logger.ts";
import { defaultOpenCodeConfigRoot } from "../state.ts";
import { applyLitAgents, createSessionModelRoute, enforcePlanningOnly, planLitAgents, registerOpenAiProviderModels } from "./agents.ts";
import { createSessionLookupV2, projectRootFromLocation, type ServerContextLike } from "./context.ts";
import { createV2Commands } from "./commands.ts";
import { createV2Events } from "./events.ts";
import { createV2ToolHooks } from "./hooks.ts";
import { createV2SessionHooks } from "./session-hooks.ts";
import { addLitTools, litToolsForProject } from "./tools.ts";

export async function setupLitOpenCodeServer(context: ServerContextLike): Promise<() => Promise<void>> {
  const root = projectRootFromLocation(context.location);
  const loaded = await loadConfig(root);
  const logger = createLogger(loaded.paths);
  const getSession = createSessionLookupV2(context.session);
  const deliverableHedgeGuard = createDeliverableHedgeGuard({ projectRoot: context.location.directory.trim() || root });
  const agentPlan = planLitAgents(loaded.config);
  const toolHooks = createV2ToolHooks({
    projectRoot: root,
    knowledgeCaptureEnabled: loaded.config.knowledge.capture,
    getSession,
    deliverableHedgeGuard
  });

  await context.model.transform(registerOpenAiProviderModels);
  await context.agent.transform((editor) => applyLitAgents(editor, agentPlan));
  await context.permission.hook("evaluate", enforcePlanningOnly);
  const tools = litToolsForProject(root);
  await context.tool.transform((editor) => addLitTools(editor, tools));
  await context.tool.hook("execute.before", toolHooks.executeBefore);
  await context.tool.hook("execute.after", toolHooks.executeAfter);

  const commands = createV2Commands([defaultOpenCodeConfigRoot(), path.join(root, ".opencode")], context.session);
  await context.command.transform((editor) => commands.add(editor));

  const events = createV2Events({
    projectRoot: root,
    paths: loaded.paths,
    autoHandoffConfig: loaded.config.autoHandoff,
    boundedAuthority: loaded.config.boundedAuthority,
    getSession,
    session: context.session,
    model: context.model,
    onSessionDeleted: (sessionID) => sessionHooks.clear(sessionID)
  });
  const sessionHooks = createV2SessionHooks({
    projectRoot: root,
    config: loaded.config,
    getSession,
    routeModel: createSessionModelRoute(agentPlan, context.session, context.model),
    requestOptions: agentPlan.requestOptions,
    autoHandoffRoute: events.route,
    extraSystem: events.systemText,
    acceptCommandMark: commands.acceptMark
  });
  await context.session.hook("prompt", sessionHooks.prompt);
  await context.session.hook("context", sessionHooks.context);
  await context.session.hook("compaction", sessionHooks.compaction);
  const stopEvents = events.start(context.event);

  return async () => {
    await stopEvents();
    deliverableHedgeGuard.dispose();
    await logger.dispose();
  };
}
