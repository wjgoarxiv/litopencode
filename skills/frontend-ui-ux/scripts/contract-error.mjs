// Trust-layer failures all surface as the same exit code, so the machine-readable
// `code` is what lets a caller separate a bad payload from an unusable file from a
// bad argument without matching on prose.
export class ContractError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = "ContractError";
    this.code = code;
  }
}

export const jsonInvalid = (message) => new ContractError("JSON_INVALID", message);
export const fileInvalid = (message) => new ContractError("FILE_INVALID", message);
export const argumentInvalid = (message) => new ContractError("ARGUMENT_INVALID", message);
export const designContractInvalid = (message) => new ContractError("DESIGN_CONTRACT_INVALID", message);
