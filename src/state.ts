import path from "node:path";

export type RuntimePaths = {
  projectRoot: string;
  runtimeDir: string;
  configFile: string;
  globalConfigFile: string;
  stateFile: string;
  logsDir: string;
  logFile: string;
  litGoalDir: string;
  litLoopDir: string;
  ledgerFile: string;
  goalsFile: string;
  briefFile: string;
  evidenceDir: string;
  lifecycleStateFile: string;
  lifecycleEventsFile: string;
  lifecycleLockDir: string;
  knowledgeDir: string;
  knowledgeClaimsFile: string;
  autoHandoffFile: string;
  opencodeConfigFile: string;
};

export const runtimeDirectoryName = ".litopencode";

export function defaultOpenCodeConfigRoot(): string {
  const configHome = process.env.XDG_CONFIG_HOME;
  if (configHome && configHome.length > 0) return path.join(configHome, "opencode");
  return path.join(process.env.HOME ?? "", ".config", "opencode");
}

export function litOpenCodeConfigFileForOpenCodeRoot(root: string = defaultOpenCodeConfigRoot()): string {
  return path.join(path.resolve(root), "litopencode.json");
}

export function createRuntimePaths(projectRoot: string): RuntimePaths {
  const root = path.resolve(projectRoot);
  const runtimeDir = path.join(root, runtimeDirectoryName);
  const litGoalDir = path.join(runtimeDir, "litgoal");
  const litLoopDir = path.join(litGoalDir, "lit-loop");

  return {
    projectRoot: root,
    runtimeDir,
    configFile: path.join(runtimeDir, "config.json"),
    globalConfigFile: litOpenCodeConfigFileForOpenCodeRoot(),
    stateFile: path.join(runtimeDir, "state.json"),
    logsDir: path.join(runtimeDir, "logs"),
    logFile: path.join(runtimeDir, "logs", "litopencode.log"),
    litGoalDir,
    litLoopDir,
    ledgerFile: path.join(litLoopDir, "ledger.jsonl"),
    goalsFile: path.join(litLoopDir, "goals.json"),
    briefFile: path.join(litLoopDir, "brief.md"),
    evidenceDir: path.join(litLoopDir, "evidence"),
    lifecycleStateFile: path.join(litLoopDir, "work-schema-3.json"),
    lifecycleEventsFile: path.join(litLoopDir, "work-schema-3.jsonl"),
    lifecycleLockDir: path.join(litLoopDir, ".work-schema-3.lock"),
    knowledgeDir: path.join(runtimeDir, "knowledge"),
    knowledgeClaimsFile: path.join(runtimeDir, "knowledge", "claims.jsonl"),
    autoHandoffFile: path.join(runtimeDir, "auto-handoff.json"),
    opencodeConfigFile: path.join(root, "opencode.json")
  };
}
