// Executable Design Contract rules for litfamily.design-contract/v1alpha1.
//
// The neighbouring JSON Schema is a shape reference only. A schema document
// cannot express typed id prefixes, referential integrity between routes,
// regions, components, interactions and states, authenticated-surface safety
// coupling, global id uniqueness, duplicate JSON keys, or canonical hashing, so
// every rule a reviewer is allowed to rely on is enforced here instead.
//
// validateDesignContract never throws for an already-parsed value: it answers
// { valid, schema, issues }. Bytes that cannot be trusted at all fail earlier,
// in the strict parser and in the bounded reader.
import { parseStrictJson } from "./strict-json.mjs";

export const designContractSchemaId = "litfamily.design-contract/v1alpha1";
export const designContractBetaSchemaId = "litfamily.design-contract/v1beta1";
export const designContractBeta2SchemaId = "litfamily.design-contract/v1beta2";

const idGrammar = /^[a-z][a-z0-9-]*:[a-z0-9][a-z0-9._/-]*$/u;
const hashGrammar = /^[0-9a-f]{64}$/u;
const controlCharacter = /[\u0000-\u001f\u007f]/u;
const utcInstantGrammar = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;

const rootKeys = Object.freeze([
  "schema_id",
  "contract_id",
  "source_hash",
  "intent",
  "direction",
  "inventory",
  "accessibility",
  "localization",
  "performance",
  "evidence_policy",
  "omissions",
  "accepted_exceptions"
]);
const betaRootKeys = Object.freeze([
  ...rootKeys,
  "lane",
  "tokens",
  "component_behaviors",
  "responsive_transformations",
  "motion",
  "acceptance_criteria"
]);
// v1beta2 adds one optional root key. Optional is the whole point: a contract that
// says nothing about taste is complete, and a v1beta1 document keeps its meaning.
const beta2RootKeys = Object.freeze([...betaRootKeys, "taste"]);
// Direction expressed as numbers a reviewer can argue with, rather than adjectives
// they cannot.
const tasteDials = Object.freeze(["variance", "motion", "density"]);
const inventoryKeys = Object.freeze([
  "routes",
  "regions",
  "components",
  "interactions",
  "states",
  "viewports",
  "references",
  "authenticated_surfaces"
]);
const stateKinds = Object.freeze([
  "loading",
  "empty",
  "error",
  "success",
  "disabled",
  "permission",
  "offline",
  "ready"
]);
const inputModes = Object.freeze(["keyboard", "pointer", "touch", "voice", "switch"]);
const viewportCategories = Object.freeze(["compact", "medium", "expanded"]);
const referenceKinds = Object.freeze(["user-provided", "repo-local", "generated", "measured"]);
const tokenStrategies = Object.freeze(["reuse", "extend", "create"]);
const evidenceChannels = Object.freeze([
  "tests",
  "browser",
  "keyboard",
  "accessibility-tree",
  "screen-reader",
  "performance",
  "localization"
]);
const lanes = Object.freeze(["new-build", "brownfield", "redesign", "reference-fidelity", "design-system"]);
const tokenCategories = Object.freeze(["color", "typography", "spacing", "radius", "shadow", "motion", "other"]);
const motionPolicies = Object.freeze(["none", "functional", "expressive"]);
const verificationMethods = Object.freeze([...evidenceChannels, "manual"]);

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isLine(value) {
  return typeof value === "string" && value.trim().length > 0 && !controlCharacter.test(value);
}

function isBetaText(value) {
  return isLine(value) && [...value].length <= 512;
}

function isId(value) {
  return typeof value === "string" && idGrammar.test(value);
}

function isTypedId(value, prefix) {
  return isId(value) && value.startsWith(`${prefix}:`);
}

function isHash(value) {
  return typeof value === "string" && hashGrammar.test(value);
}

function isBoundedInteger(value, minimum, maximum) {
  return Number.isInteger(value) && value >= minimum && value <= maximum;
}

function isBoundedNumber(value, minimum, maximum) {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
}

// Strict ISO-8601 UTC. The grammar rejects offsets, microseconds and a lowercase
// designator; the round trip then rejects instants the host silently rolls over,
// such as a 31st of February or an hour of 24.
function isUtcInstant(value) {
  if (typeof value !== "string" || !utcInstantGrammar.test(value)) return false;
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return false;
  const declared = value.includes(".") ? value : `${value.slice(0, -1)}.000Z`;
  return new Date(milliseconds).toISOString() === declared;
}

function keys(value, { allowed, required = allowed }, label, issues) {
  if (!isObject(value)) {
    issues.push(`${label} must be an object`);
    return false;
  }
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) issues.push(`${label} declares the unsupported key ${key}`);
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) issues.push(`${label} is missing ${key}`);
  }
  return true;
}

function records(value, label, issues) {
  if (!Array.isArray(value)) {
    issues.push(`${label} must be an array`);
    return [];
  }
  return value.filter((item, index) => {
    if (isObject(item)) return true;
    issues.push(`${label}[${index}] must be an object`);
    return false;
  });
}

function lines(value, label, issues, { minimum = 0, maximum = Number.POSITIVE_INFINITY } = {}) {
  if (!Array.isArray(value)) {
    issues.push(`${label} must be an array`);
    return;
  }
  if (value.length < minimum) issues.push(`${label} must declare at least ${minimum} entries`);
  if (value.length > maximum) issues.push(`${label} must declare at most ${maximum} entries`);
  if (value.some((item) => !isLine(item))) issues.push(`${label} entries must be non-empty single-line text`);
  if (new Set(value).size !== value.length) issues.push(`${label} entries must be unique`);
}

function enumSubset(value, allowed, label, issues) {
  if (!Array.isArray(value) || value.length === 0) {
    issues.push(`${label} must name at least one supported value`);
    return;
  }
  if (value.some((item) => !allowed.includes(item))) issues.push(`${label} names an unsupported value`);
  if (new Set(value).size !== value.length) issues.push(`${label} entries must be unique`);
}

function booleans(value, fields, label, issues) {
  for (const field of fields) {
    if (typeof value[field] !== "boolean") issues.push(`${label}.${field} must be true or false`);
  }
}

function checkIntent(value, issues) {
  if (!keys(value, { allowed: ["audiences", "tasks", "qualities", "constraints", "non_goals"] }, "intent", issues)) {
    return;
  }
  for (const field of ["audiences", "tasks", "qualities"]) {
    lines(value[field], `intent.${field}`, issues, { minimum: 1 });
  }
  for (const field of ["constraints", "non_goals"]) {
    lines(value[field], `intent.${field}`, issues);
  }
}

function checkDirection(value, issues) {
  if (!keys(value, { allowed: ["name", "principles", "token_strategy", "voice"] }, "direction", issues)) return;
  for (const field of ["name", "voice"]) {
    if (!isLine(value[field])) issues.push(`direction.${field} must be non-empty single-line text`);
  }
  lines(value.principles, "direction.principles", issues, { minimum: 3, maximum: 7 });
  if (!tokenStrategies.includes(value.token_strategy)) {
    issues.push("direction.token_strategy must be reuse, extend, or create");
  }
}

function checkRoutes(items, ids, issues) {
  for (const item of items) {
    keys(item, { allowed: ["id", "path", "primary", "auth_required"] }, "route", issues);
    if (!isTypedId(item.id, "route")) issues.push("route id must be a route: identifier");
    else ids.push(item.id);
    if (!isLine(item.path)) issues.push(`route ${String(item.id)} must declare a path`);
    booleans(item, ["primary", "auth_required"], `route ${String(item.id)}`, issues);
  }
  if (items.length === 0) issues.push("inventory.routes must declare at least one route");
  else if (!items.some((item) => item.primary === true)) {
    issues.push("inventory.routes must mark at least one route primary");
  }
}

function checkRegions(items, ids, issues) {
  for (const item of items) {
    keys(item, { allowed: ["id", "route_id"] }, "region", issues);
    if (!isTypedId(item.id, "region")) issues.push("region id must be a region: identifier");
    else ids.push(item.id);
    if (!isTypedId(item.route_id, "route")) issues.push(`region ${String(item.id)} must name a route: identifier`);
  }
  if (items.length === 0) issues.push("inventory.regions must declare at least one region");
}

function checkComponents(items, ids, issues) {
  for (const item of items) {
    keys(item, { allowed: ["id", "region_id"] }, "component", issues);
    if (!isTypedId(item.id, "component")) issues.push("component id must be a component: identifier");
    else ids.push(item.id);
    if (!isTypedId(item.region_id, "region")) {
      issues.push(`component ${String(item.id)} must name a region: identifier`);
    }
  }
  if (items.length === 0) issues.push("inventory.components must declare at least one component");
}

function checkInteractions(items, ids, issues) {
  for (const item of items) {
    keys(item, { allowed: ["id", "route_id", "critical", "input_modes"] }, "interaction", issues);
    if (!isTypedId(item.id, "interaction")) issues.push("interaction id must be an interaction: identifier");
    else ids.push(item.id);
    if (!isTypedId(item.route_id, "route")) {
      issues.push(`interaction ${String(item.id)} must name a route: identifier`);
    }
    booleans(item, ["critical"], `interaction ${String(item.id)}`, issues);
    enumSubset(item.input_modes, inputModes, `interaction ${String(item.id)} input_modes`, issues);
  }
  if (items.length === 0) issues.push("inventory.interactions must declare at least one interaction");
  else if (!items.some((item) => item.critical === true)) {
    issues.push("inventory.interactions must mark at least one interaction critical");
  }
}

function checkStates(items, ids, issues) {
  for (const item of items) {
    keys(item, { allowed: ["id", "route_id", "kind"] }, "state", issues);
    if (!isTypedId(item.id, "state")) issues.push("state id must be a state: identifier");
    else ids.push(item.id);
    if (!isTypedId(item.route_id, "route")) issues.push(`state ${String(item.id)} must name a route: identifier`);
    if (!stateKinds.includes(item.kind)) issues.push(`state ${String(item.id)} declares an unsupported kind`);
  }
}

function checkViewports(items, ids, issues) {
  for (const item of items) {
    keys(item, { allowed: ["id", "width", "height", "category"] }, "viewport", issues);
    if (!isTypedId(item.id, "viewport")) issues.push("viewport id must be a viewport: identifier");
    else ids.push(item.id);
    for (const field of ["width", "height"]) {
      if (!isBoundedInteger(item[field], 240, 16384)) {
        issues.push(`viewport ${String(item.id)} ${field} must be an integer from 240 through 16384`);
      }
    }
    if (!viewportCategories.includes(item.category)) {
      issues.push(`viewport ${String(item.id)} category must be compact, medium, or expanded`);
    }
  }
}

function checkReferences(items, ids, issues) {
  for (const item of items) {
    keys(item, { allowed: ["id", "sha256", "kind", "label"] }, "reference", issues);
    if (!isTypedId(item.id, "reference")) issues.push("reference id must be a reference: identifier");
    else ids.push(item.id);
    if (!isHash(item.sha256)) {
      issues.push(`reference ${String(item.id)} sha256 must be 64 lowercase hexadecimal digits`);
    }
    if (!referenceKinds.includes(item.kind)) issues.push(`reference ${String(item.id)} declares an unsupported kind`);
    if (!isLine(item.label)) issues.push(`reference ${String(item.id)} must declare a label`);
  }
}

// Authenticated surfaces are keyed by the route they unlock, so they contribute
// no identifier of their own to the global id space.
function checkAuthenticatedSurfaces(items, issues) {
  for (const item of items) {
    keys(item, { allowed: ["route_id", "owner", "safe_test_account"] }, "authenticated surface", issues);
    if (!isTypedId(item.route_id, "route")) issues.push("authenticated surface must name a route: identifier");
    if (!isLine(item.owner)) issues.push(`authenticated surface ${String(item.route_id)} must name an owner`);
    booleans(item, ["safe_test_account"], `authenticated surface ${String(item.route_id)}`, issues);
  }
}

function checkReferentialIntegrity(inventory, issues) {
  const routeIds = new Set(inventory.routes.map((item) => item.id));
  const regionIds = new Set(inventory.regions.map((item) => item.id));
  for (const item of inventory.regions) {
    if (!routeIds.has(item.route_id)) issues.push(`region ${String(item.id)} names an undeclared route`);
  }
  for (const item of inventory.components) {
    if (!regionIds.has(item.region_id)) issues.push(`component ${String(item.id)} names an undeclared region`);
  }
  for (const item of [...inventory.interactions, ...inventory.states]) {
    if (!routeIds.has(item.route_id)) issues.push(`${String(item.id)} names an undeclared route`);
  }
  return routeIds;
}

// Authentication safety is a coupling, not a per-item field: a locked route
// without an owned surface, an open route with one, or a surface without an
// explicitly safe test account are all contract defects.
function checkAuthenticationSafety(inventory, routeIds, issues) {
  const surfaceByRoute = new Map();
  for (const surface of inventory.authenticated_surfaces) {
    if (!routeIds.has(surface.route_id)) {
      issues.push(`authenticated surface ${String(surface.route_id)} names an undeclared route`);
    }
    if (surfaceByRoute.has(surface.route_id)) {
      issues.push(`route ${String(surface.route_id)} declares more than one authenticated surface`);
    } else surfaceByRoute.set(surface.route_id, surface);
    if (surface.safe_test_account !== true) {
      issues.push(`authenticated surface ${String(surface.route_id)} must assert a safe test account`);
    }
  }
  for (const route of inventory.routes) {
    const surface = surfaceByRoute.get(route.id);
    if (route.auth_required === true && surface === undefined) {
      issues.push(`route ${String(route.id)} requires authentication without an authenticated surface`);
    }
    if (route.auth_required === false && surface !== undefined) {
      issues.push(`public route ${String(route.id)} must not declare an authenticated surface`);
    }
  }
}

function checkInventory(value, issues) {
  if (!keys(value, { allowed: inventoryKeys }, "inventory", issues)) return [];
  const inventory = Object.fromEntries(
    inventoryKeys.map((key) => [key, records(value[key], `inventory.${key}`, issues)])
  );
  const ids = [];
  checkRoutes(inventory.routes, ids, issues);
  checkRegions(inventory.regions, ids, issues);
  checkComponents(inventory.components, ids, issues);
  checkInteractions(inventory.interactions, ids, issues);
  checkStates(inventory.states, ids, issues);
  checkViewports(inventory.viewports, ids, issues);
  checkReferences(inventory.references, ids, issues);
  checkAuthenticatedSurfaces(inventory.authenticated_surfaces, issues);
  const routeIds = checkReferentialIntegrity(inventory, issues);
  checkAuthenticationSafety(inventory, routeIds, issues);
  return ids;
}

function checkAccessibility(value, issues) {
  const allowed = ["target", "keyboard", "screen_reader", "reduced_motion", "forced_colors", "zoom_percent"];
  if (!keys(value, { allowed }, "accessibility", issues)) return;
  if (value.target !== "WCAG 2.2 AA") issues.push("accessibility.target must be exactly WCAG 2.2 AA");
  booleans(value, ["keyboard", "screen_reader", "reduced_motion", "forced_colors"], "accessibility", issues);
  if (!isBoundedInteger(value.zoom_percent, 200, 400)) {
    issues.push("accessibility.zoom_percent must be an integer from 200 through 400");
  }
}

function checkLocalization(value, issues) {
  const reviews = ["cjk_line_break_review", "font_fallback_review", "ime_review", "rtl_review"];
  if (!keys(value, { allowed: ["locales", "text_expansion_percent", ...reviews] }, "localization", issues)) return;
  lines(value.locales, "localization.locales", issues, { minimum: 1 });
  if (!isBoundedInteger(value.text_expansion_percent, 0, 300)) {
    issues.push("localization.text_expansion_percent must be an integer from 0 through 300");
  }
  booleans(value, reviews, "localization", issues);
}

// Every performance dimension is bounded on both ends; an open-ended budget is
// not a budget.
function checkPerformance(value, issues) {
  const allowed = ["lcp_ms", "cls", "inp_ms", "initial_js_kb", "initial_css_kb"];
  if (!keys(value, { allowed }, "performance", issues)) return;
  for (const [field, minimum, maximum] of [
    ["lcp_ms", 1, 60000],
    ["inp_ms", 1, 60000],
    ["initial_js_kb", 0, 1048576],
    ["initial_css_kb", 0, 1048576]
  ]) {
    if (!isBoundedInteger(value[field], minimum, maximum)) {
      issues.push(`performance.${field} must be an integer from ${minimum} through ${maximum}`);
    }
  }
  if (!isBoundedNumber(value.cls, 0, 1)) issues.push("performance.cls must be a number from 0 through 1");
}

function checkEvidencePolicy(value, issues) {
  const allowed = ["independent_review_required", "required_channels", "cleanup_required"];
  if (!keys(value, { allowed }, "evidence_policy", issues)) return;
  booleans(value, ["independent_review_required", "cleanup_required"], "evidence_policy", issues);
  enumSubset(value.required_channels, evidenceChannels, "evidence_policy.required_channels", issues);
}

// An accepted exception forgives a gating finding, so it must say when it stops doing so:
// requireExpiry is true only for accepted_exceptions. An omission records work that was not
// done and forgives nothing, so it keeps the optional expiry it has always had.
function checkDeviations(value, label, ids, issues, { requireExpiry = false } = {}) {
  const required = requireExpiry ? ["id", "reason", "owner", "expires_at"] : ["id", "reason", "owner"];
  for (const item of records(value, label, issues)) {
    keys(item, { allowed: ["id", "reason", "owner", "expires_at"], required }, label, issues);
    if (!isId(item.id)) issues.push(`${label} id must follow the identifier grammar`);
    else ids.push(item.id);
    for (const field of ["reason", "owner"]) {
      if (!isLine(item[field])) issues.push(`${label} ${String(item.id)} must declare ${field}`);
    }
    if (Object.hasOwn(item, "expires_at") && !isUtcInstant(item.expires_at)) {
      issues.push(`${label} ${String(item.id)} expires_at must be a strict ISO-8601 UTC instant`);
    }
  }
}

function declaredIds(inventory, category) {
  if (!isObject(inventory) || !Array.isArray(inventory[category])) return new Set();
  return new Set(inventory[category].filter(isObject).map((item) => item.id).filter((id) => typeof id === "string"));
}

function checkBetaReferences(value, label, prefix, declared, issues) {
  lines(value, label, issues, { minimum: 1, maximum: 64 });
  if (!Array.isArray(value)) return;
  for (const id of value) {
    if (!isTypedId(id, prefix)) issues.push(`${label} must use ${prefix}: identifiers`);
    else if (!declared.has(id)) issues.push(`${id} is not a declared ${prefix}`);
  }
}

// One defect, one issue. A reviewer fixing a dial wants the dial named, not a list
// of every consequence of the same mistake.
function checkTaste(contract, issues) {
  if (!Object.hasOwn(contract, "taste")) return;
  const taste = contract.taste;
  if (!isObject(taste)) {
    issues.push("taste must be an object declaring variance, motion and density");
    return;
  }
  const unknown = Object.keys(taste).filter((dial) => !tasteDials.includes(dial));
  if (unknown.length > 0) {
    issues.push(`taste declares the unsupported dial ${unknown.join(", ")}`);
    return;
  }
  for (const dial of tasteDials) {
    if (!Object.hasOwn(taste, dial)) {
      issues.push(`taste.${dial} is required whenever taste is declared`);
      return;
    }
    if (!isBoundedInteger(taste[dial], 1, 10)) {
      issues.push(`taste.${dial} must be an integer from 1 through 10`);
      return;
    }
  }
}

function checkBetaExtension(contract, issues) {
  const ids = [];
  if (!lanes.includes(contract.lane)) issues.push("lane must name a supported operating lane");
  const routes = declaredIds(contract.inventory, "routes");
  const components = declaredIds(contract.inventory, "components");
  const interactions = declaredIds(contract.inventory, "interactions");
  const states = declaredIds(contract.inventory, "states");
  const viewports = declaredIds(contract.inventory, "viewports");
  const allInventoryIds = new Set(inventoryKeys.flatMap((category) => [...declaredIds(contract.inventory, category)]));

  const tokens = records(contract.tokens, "tokens", issues);
  if (tokens.length === 0) issues.push("tokens must declare at least one token");
  for (const token of tokens) {
    keys(token, { allowed: ["id", "category", "value", "usage"] }, "token", issues);
    if (!isTypedId(token.id, "token")) issues.push("token id must be a token: identifier");
    else ids.push(token.id);
    if (!tokenCategories.includes(token.category)) issues.push(`token ${String(token.id)} category is unsupported`);
    if (!isBetaText(token.value)) issues.push(`token ${String(token.id)} value must be 1..512 characters of single-line text`);
    if (!isBetaText(token.usage)) issues.push(`token ${String(token.id)} usage must be 1..512 characters of single-line text`);
  }

  const behaviors = records(contract.component_behaviors, "component_behaviors", issues);
  if (behaviors.length === 0) issues.push("component_behaviors must declare at least one behavior");
  for (const behavior of behaviors) {
    keys(behavior, { allowed: ["component_id", "state_ids", "interaction_ids", "keyboard_behavior"] }, "component behavior", issues);
    if (!isTypedId(behavior.component_id, "component")) issues.push("component behavior must name a component: identifier");
    else if (!components.has(behavior.component_id)) issues.push(`${behavior.component_id} is not a declared component`);
    checkBetaReferences(behavior.state_ids, `component ${String(behavior.component_id)} state_ids`, "state", states, issues);
    checkBetaReferences(behavior.interaction_ids, `component ${String(behavior.component_id)} interaction_ids`, "interaction", interactions, issues);
    if (!isBetaText(behavior.keyboard_behavior)) issues.push(`component ${String(behavior.component_id)} keyboard_behavior must be 1..512 characters of single-line text`);
  }

  const transformations = records(contract.responsive_transformations, "responsive_transformations", issues);
  if (transformations.length === 0) issues.push("responsive_transformations must declare at least one transformation");
  for (const transformation of transformations) {
    keys(transformation, { allowed: ["route_id", "viewport_id", "behavior"] }, "responsive transformation", issues);
    if (!isTypedId(transformation.route_id, "route") || !routes.has(transformation.route_id)) {
      issues.push(`${String(transformation.route_id)} is not a declared route`);
    }
    if (!isTypedId(transformation.viewport_id, "viewport") || !viewports.has(transformation.viewport_id)) {
      issues.push(`${String(transformation.viewport_id)} is not a declared viewport`);
    }
    if (!isBetaText(transformation.behavior)) issues.push("responsive transformation behavior must be 1..512 characters of single-line text");
  }

  if (!isObject(contract.motion)) issues.push("motion must be an object");
  else {
    keys(contract.motion, { allowed: ["policy", "reduced_motion_behavior", "transitions"] }, "motion", issues);
    if (!motionPolicies.includes(contract.motion.policy)) issues.push("motion.policy is unsupported");
    if (!isBetaText(contract.motion.reduced_motion_behavior)) issues.push("motion.reduced_motion_behavior must be 1..512 characters of single-line text");
    const transitions = records(contract.motion.transitions, "motion.transitions", issues);
    if (contract.motion.policy !== "none" && transitions.length === 0) issues.push("active motion policy requires a transition");
    if (contract.motion.policy === "none" && transitions.length > 0) issues.push("motion policy none forbids transitions");
    for (const transition of transitions) {
      keys(transition, { allowed: ["id", "interaction_id", "duration_ms", "easing"] }, "transition", issues);
      if (!isTypedId(transition.id, "transition")) issues.push("transition id must be a transition: identifier");
      else ids.push(transition.id);
      if (!isTypedId(transition.interaction_id, "interaction") || !interactions.has(transition.interaction_id)) {
        issues.push(`${String(transition.interaction_id)} is not a declared interaction`);
      }
      if (!isBoundedInteger(transition.duration_ms, 0, 10000)) issues.push("transition.duration_ms must be an integer from 0 through 10000");
      if (!isBetaText(transition.easing)) issues.push(`transition ${String(transition.id)} easing must be 1..512 characters of single-line text`);
    }
  }

  const criteria = records(contract.acceptance_criteria, "acceptance_criteria", issues);
  if (criteria.length === 0) issues.push("acceptance_criteria must declare at least one criterion");
  for (const criterion of criteria) {
    keys(criterion, { allowed: ["id", "observable", "verification", "required", "inventory_ids"] }, "acceptance criterion", issues);
    if (!isTypedId(criterion.id, "criterion")) issues.push("criterion id must be a criterion: identifier");
    else ids.push(criterion.id);
    if (!isBetaText(criterion.observable)) issues.push(`criterion ${String(criterion.id)} observable must be 1..512 characters of single-line text`);
    if (!verificationMethods.includes(criterion.verification)) issues.push(`criterion ${String(criterion.id)} verification is unsupported`);
    if (criterion.required !== true) issues.push(`criterion ${String(criterion.id)} required must be true`);
    lines(criterion.inventory_ids, `criterion ${String(criterion.id)} inventory_ids`, issues, { minimum: 1, maximum: 64 });
    if (Array.isArray(criterion.inventory_ids)) {
      for (const id of criterion.inventory_ids) if (!allInventoryIds.has(id)) issues.push(`${String(id)} is not declared in contract inventory`);
    }
  }
  return ids;
}

export function validateDesignContract(contract) {
  const issues = [];
  if (!isObject(contract)) {
    return {
      valid: false,
      schema: designContractSchemaId,
      issues: ["contract must be an object"],
      diagnostics: [],
      evidence_eligible: false
    };
  }
  const beta2 = contract.schema_id === designContractBeta2SchemaId;
  const beta = beta2 || contract.schema_id === designContractBetaSchemaId;
  const alpha = contract.schema_id === designContractSchemaId;
  const schema = beta2 ? designContractBeta2SchemaId : (beta ? designContractBetaSchemaId : designContractSchemaId);
  const allowed = beta2 ? beta2RootKeys : (beta ? betaRootKeys : rootKeys);
  keys(contract, { allowed, required: beta2 ? betaRootKeys : allowed }, "contract", issues);
  if (!alpha && !beta) {
    issues.push(
      `schema_id must be exactly ${designContractSchemaId}, ${designContractBetaSchemaId} or ${designContractBeta2SchemaId}`
    );
  }
  if (!isTypedId(contract.contract_id, "contract")) issues.push("contract_id must be a contract: identifier");
  if (!isHash(contract.source_hash)) issues.push("source_hash must be 64 lowercase hexadecimal digits");
  checkIntent(contract.intent, issues);
  checkDirection(contract.direction, issues);
  const inventoryIds = checkInventory(contract.inventory, issues);
  checkAccessibility(contract.accessibility, issues);
  checkLocalization(contract.localization, issues);
  checkPerformance(contract.performance, issues);
  checkEvidencePolicy(contract.evidence_policy, issues);
  const deviationIds = [];
  checkDeviations(contract.omissions, "omissions", deviationIds, issues);
  checkDeviations(contract.accepted_exceptions, "accepted_exceptions", deviationIds, issues, { requireExpiry: true });
  if (beta) checkTaste(contract, issues);
  const betaIds = beta ? checkBetaExtension(contract, issues) : [];
  const declaredIds = [contract.contract_id, ...inventoryIds, ...deviationIds, ...betaIds].filter(isId);
  if (new Set(declaredIds).size !== declaredIds.length) {
    issues.push("every declared identifier must be unique across the whole contract");
  }
  const valid = issues.length === 0;
  return {
    valid,
    schema,
    issues,
    diagnostics: alpha ? ["LEGACY_SCHEMA_V1ALPHA1"] : [],
    evidence_eligible: beta && valid
  };
}

export function validateDesignContractText(text) {
  return validateDesignContract(parseStrictJson(text));
}
