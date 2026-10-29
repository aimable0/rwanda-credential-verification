import { ethers } from "ethers";
import dotenv from "dotenv";

dotenv.config();

const CREDENTIAL_REGISTRY_ABI = [
  "function getRecordByReferenceCode(string calldata _referenceCode) external view returns (bytes32 credentialHash, address issuer, uint256 issuedAt, uint256 revocationTimestamp, bool exists)",
  "function checkStatus(bytes32 _credentialHash) external view returns (uint256 revocationTimestamp)",
  "function hec() external view returns (address)",
  "function accreditedIssuers(address) external view returns (bool)",
];

const rpcUrl = process.env.SEPOLIA_RPC_URL;
const contractAddress = process.env.CONTRACT_ADDRESS;

if (!rpcUrl || !contractAddress) {
  console.warn("Warning: SEPOLIA_RPC_URL or CONTRACT_ADDRESS missing in .env");
}

export const provider = new ethers.JsonRpcProvider(rpcUrl);

export const registryContract = new ethers.Contract(
  contractAddress || ethers.ZeroAddress,
  CREDENTIAL_REGISTRY_ABI,
  provider,
);

export interface OnChainRecord {
  credentialHash: string;
  issuer: string;
  issuedAt: number;
  revocationTimestamp: number;
  exists: boolean;
}

export async function getOnChainCredential(
  referenceCode: string,
): Promise<OnChainRecord> {
  const normalizedCode = referenceCode.trim().toUpperCase();
  const [credentialHash, issuer, issuedAt, revocationTimestamp, exists] =
    await registryContract.getRecordByReferenceCode(normalizedCode);

  return {
    credentialHash,
    issuer,
    issuedAt: Number(issuedAt),
    revocationTimestamp: Number(revocationTimestamp),
    exists,
  };
}

// The HEC wallet is immutable in the contract, so it is read once and cached.
let cachedHec: string | null = null;

export async function getHecAddress(): Promise<string> {
  if (!cachedHec) {
    cachedHec = (await registryContract.hec()) as string;
  }
  return cachedHec;
}

/** True when HEC currently lists this wallet as an accredited issuer on-chain. */
export async function isIssuerAccredited(wallet: string): Promise<boolean> {
  return (await registryContract.accreditedIssuers(wallet)) as boolean;
}
