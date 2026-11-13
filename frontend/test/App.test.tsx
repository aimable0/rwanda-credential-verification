import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  baseRoutes,
  connectWallet,
  HEC_WALLET,
  institution,
  mockApi,
  OTHER_WALLET,
  renderAt,
  sentBody,
  signedIn,
  UNIVA_WALLET,
} from "./helpers";

/* ---------- Public pages ---------- */

describe("landing and 404", () => {
  it("offers the three roles", async () => {
    mockApi(baseRoutes());
    renderAt("/");
    expect(screen.getByRole("link", { name: "Verify a credential" })).toHaveAttribute("href", "/verify");
    expect(screen.getByRole("link", { name: "Institution sign in" })).toHaveAttribute("href", "/register");
    expect(screen.getByRole("link", { name: "HEC sign in" })).toHaveAttribute("href", "/admin");
  });

  it("shows a 404 page for unknown paths", () => {
    mockApi(baseRoutes());
    renderAt("/no-such-page");
    expect(screen.getByRole("heading", { name: "Page not found" })).toBeInTheDocument();
    expect(screen.getByText("/no-such-page")).toBeInTheDocument();
  });
});

/* ---------- Phone menu ---------- */

describe("phone menu", () => {
  const menuButton = () => screen.getByRole("button", { name: /menu/i });

  it("starts closed and opens with About, User guide and the sign-in link", async () => {
    mockApi(baseRoutes());
    renderAt("/verify");
    const user = userEvent.setup();

    expect(menuButton()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("navigation", { name: "Menu" })).not.toBeInTheDocument();

    await user.click(menuButton());
    expect(menuButton()).toHaveAttribute("aria-expanded", "true");
    const menu = within(screen.getByRole("navigation", { name: "Menu" }));
    expect(menu.getByRole("link", { name: "About" })).toHaveAttribute("href", "/about");
    expect(menu.getByRole("link", { name: "User guide" })).toHaveAttribute("href", "/guide");
    expect(menu.getByRole("link", { name: "Institution or HEC sign in" })).toHaveAttribute("href", "/");
  });

  it("closes after following a link and on Escape", async () => {
    mockApi(baseRoutes());
    renderAt("/verify");
    const user = userEvent.setup();

    await user.click(menuButton());
    await user.click(
      within(screen.getByRole("navigation", { name: "Menu" })).getByRole("link", { name: "About" }),
    );
    expect(await screen.findByRole("heading", { name: "About the platform" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Menu" })).not.toBeInTheDocument();

    await user.click(menuButton());
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("navigation", { name: "Menu" })).not.toBeInTheDocument();
  });

  it("holds the role links and wallet for institution pages", async () => {
    mockApi(baseRoutes([institution()]));
    connectWallet(UNIVA_WALLET);
    renderAt("/register");
    const user = userEvent.setup();
    await screen.findByRole("link", { name: "Open portal" });

    await user.click(menuButton());
    const menu = within(screen.getByRole("navigation", { name: "Menu" }));
    expect(menu.getByRole("link", { name: "My institution" })).toHaveAttribute("aria-current", "page");
    expect(menu.getByRole("link", { name: "Issue credentials" })).toHaveAttribute("href", "/UNIVA/issue_degree");
    expect(menu.getByRole("button", { name: "Switch account" })).toBeInTheDocument();
  });
});

/* ---------- Verify ---------- */

describe("verify page", () => {
  const genuine = {
    referenceCode: "UNIVA-T-001",
    certificateNumber: "T-001",
    result: "GENUINE_AND_ACTIVE",
    responseTimeMs: 420,
    details: {
      recomputedHash: "0xabc",
      anchoredHash: "0xabc",
      issuerAddress: UNIVA_WALLET,
      issuerInstitution: { code: "UNIVA", name: "University A" },
      issuedAtTimestamp: 1760000000,
      revocationTimestamp: 0,
    },
  };

  async function fillAndSubmit() {
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/holder full name/i), "Dukundimana Desire");
    await user.type(screen.getByLabelText(/degree or license title/i), "Bachelor of Education");
    await user.click(screen.getByRole("button", { name: "Verify credential" }));
  }

  it("pre-fills the certificate number and institution from a QR link", async () => {
    mockApi(baseRoutes([institution(), institution({ code: "UNIVB", name: "University B" })]));
    renderAt("/verify?ref=T-001&inst=UNIVB");
    expect(screen.getByLabelText(/certificate number/i)).toHaveValue("T-001");
    await screen.findByRole("option", { name: "UNIVB - University B" });
    expect(screen.getByLabelText(/issuing institution/i)).toHaveValue("UNIVB");
  });

  it("starts with no institution selected when there is no QR link", async () => {
    mockApi(baseRoutes([institution()]));
    renderAt("/verify");
    await screen.findByRole("option", { name: "UNIVA - University A" });
    expect(screen.getByLabelText(/issuing institution/i)).toHaveValue("");
  });

  it("sends the entered fields and shows a genuine result", async () => {
    const fetchMock = mockApi({
      ...baseRoutes([institution()]),
      "POST /credentials/verify": { body: genuine },
    });
    renderAt("/verify?ref=T-001&inst=UNIVA");
    await screen.findByRole("option", { name: "UNIVA - University A" });
    await fillAndSubmit();

    expect(await screen.findByRole("heading", { name: "Genuine and active" })).toBeInTheDocument();
    expect(screen.getByText("University A (UNIVA)")).toBeInTheDocument();
    expect(screen.getByText("Hashes match")).toBeInTheDocument();
    expect(sentBody(fetchMock, "/credentials/verify")).toMatchObject({
      referenceCode: "T-001",
      institution: "UNIVA",
      holderName: "Dukundimana Desire",
      degreeTitle: "Bachelor of Education",
      classification: "FIRST_CLASS_HONOURS",
      awardDate: "2026-06-15",
      scenarioType: "GENUINE",
    });
  });

  it("shows no record details on a mismatch", async () => {
    mockApi({
      ...baseRoutes([institution()]),
      "POST /credentials/verify": {
        body: { ...genuine, result: "MISMATCH_OR_NOT_FOUND", details: {} },
      },
    });
    renderAt("/verify?ref=T-001&inst=UNIVA");
    await screen.findByRole("option", { name: "UNIVA - University A" });
    await fillAndSubmit();

    expect(await screen.findByRole("heading", { name: "Mismatch or not found" })).toBeInTheDocument();
    expect(screen.queryByText("Recomputed hash")).not.toBeInTheDocument();
    expect(screen.queryByText(/Issued by/)).not.toBeInTheDocument();
  });

  it("shows the server's error message, including its reference id", async () => {
    mockApi({
      ...baseRoutes([institution()]),
      "POST /credentials/verify": {
        status: 500,
        body: { error: "Something went wrong on the server. Please try again. (Reference: 1a2b3c4d)" },
      },
    });
    renderAt("/verify?ref=T-001&inst=UNIVA");
    await screen.findByRole("option", { name: "UNIVA - University A" });
    await fillAndSubmit();
    expect(await screen.findByText(/Reference: 1a2b3c4d/)).toBeInTheDocument();
  });
});

/* ---------- Institution registration ---------- */

describe("institution registration", () => {
  it("asks for a wallet before anything else", async () => {
    mockApi(baseRoutes());
    renderAt("/register");
    expect(screen.getByRole("button", { name: "Connect MetaMask wallet" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Apply to HEC" })).not.toBeInTheDocument();
  });

  it("enables Apply only once both code and name are filled in", async () => {
    mockApi(baseRoutes());
    connectWallet(UNIVA_WALLET);
    renderAt("/register");
    const user = userEvent.setup();
    const apply = await screen.findByRole("button", { name: "Apply to HEC" });

    expect(apply).toBeDisabled();
    await user.type(screen.getByLabelText(/institution code/i), "UNIVX");
    expect(apply).toBeDisabled();
    await user.type(screen.getByLabelText(/institution name/i), "Test University");
    expect(apply).toBeEnabled();
  });

  it("warns when the typed code already has a pending application from another wallet", async () => {
    mockApi(baseRoutes([institution({ accreditation_status: "PENDING", wallet_address: OTHER_WALLET })]));
    connectWallet(UNIVA_WALLET);
    renderAt("/register");
    const user = userEvent.setup();
    await screen.findByRole("button", { name: "Apply to HEC" });

    await user.type(screen.getByLabelText(/institution code/i), "univa");
    await user.type(screen.getByLabelText(/institution name/i), "University A");
    expect(screen.getByText(/already has a pending application from another wallet/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply to HEC" })).toBeDisabled();
  });

  it("rejects a malformed code without contacting the server", async () => {
    const fetchMock = mockApi(baseRoutes());
    connectWallet(UNIVA_WALLET);
    renderAt("/register");
    const user = userEvent.setup();
    await screen.findByRole("button", { name: "Apply to HEC" });

    await user.type(screen.getByLabelText(/institution code/i), "U-1");
    await user.type(screen.getByLabelText(/institution name/i), "Test University");
    await user.click(screen.getByRole("button", { name: "Apply to HEC" }));

    expect(await screen.findByText(/code must be 2-20 letters or digits/)).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("/institutions/apply"))).toBe(false);
  });

  it("sends the code, name and type with the wallet token", async () => {
    const fetchMock = mockApi({
      ...baseRoutes(),
      "POST /institutions/apply": {
        status: 201,
        body: { message: "Application for Test University (UNIVX) sent to HEC" },
      },
    });
    connectWallet(UNIVA_WALLET);
    signedIn(UNIVA_WALLET);
    renderAt("/register");
    const user = userEvent.setup();
    await screen.findByRole("button", { name: "Apply to HEC" });

    await user.type(screen.getByLabelText(/institution code/i), " univx ");
    await user.type(screen.getByLabelText(/institution name/i), "Test University");
    await user.selectOptions(screen.getByLabelText(/institution type/i), "LICENSING_BODY");
    await user.click(screen.getByRole("button", { name: "Apply to HEC" }));

    expect(await screen.findByText(/sent to HEC/)).toBeInTheDocument();
    expect(sentBody(fetchMock, "/institutions/apply")).toEqual({
      code: "UNIVX",
      name: "Test University",
      institutionType: "LICENSING_BODY",
    });
    const call = fetchMock.mock.calls.find(([u]) => String(u).includes("/institutions/apply"));
    const headers = (call?.[1]?.headers ?? {}) as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer test-token");
  });

  it("links an accredited wallet to its issuing portal", async () => {
    mockApi(baseRoutes([institution()]));
    connectWallet(UNIVA_WALLET);
    renderAt("/register");
    expect(await screen.findByRole("link", { name: "Open portal" })).toHaveAttribute(
      "href",
      "/UNIVA/issue_degree",
    );
    expect(screen.getByRole("link", { name: "Issue credentials" })).toBeInTheDocument();
  });
});

/* ---------- Issuing portal ---------- */

describe("issuing portal", () => {
  const row = (id: number, ref: string, extra: object) => ({
    credential_id: id,
    reference_code: ref,
    credential_hash: `0x${String(id).repeat(64)}`,
    holder_reference: `REF-HOLDER-${id}`,
    issuance_date: "2026-06-15",
    credential_type: "ACADEMIC_DEGREE",
    institution_code: "UNIVA",
    institution_name: "University A",
    ...extra,
  });

  it("shows each credential's chain status and offers Revoke only where it can work", async () => {
    mockApi({
      ...baseRoutes([institution()]),
      "GET /credentials": {
        body: [
          row(1, "UNIVA-T-001", { chain_status: "ANCHORED", revoked_at: null }),
          row(2, "UNIVA-T-002", { chain_status: "ANCHORED", revoked_at: 1770000000 }),
          row(3, "UNIVA-T-003", { chain_status: "NOT_ANCHORED", revoked_at: null }),
          row(4, "UNIVA-T-004", { chain_status: "HASH_MISMATCH", revoked_at: null }),
          row(5, "UNIVA-T-005", { chain_status: "UNKNOWN", revoked_at: null }),
        ],
      },
    });
    connectWallet(UNIVA_WALLET);
    signedIn(UNIVA_WALLET);
    renderAt("/UNIVA/issue_degree");

    const rowFor = async (cert: string) =>
      within((await screen.findByText(cert)).closest("tr") as HTMLElement);

    expect((await rowFor("T-001")).getByText("Active")).toBeInTheDocument();
    expect((await rowFor("T-001")).getByRole("button", { name: "Revoke on-chain" })).toBeInTheDocument();
    expect((await rowFor("T-002")).getByText("Revoked")).toBeInTheDocument();
    expect((await rowFor("T-002")).getByText(/Revoked on/)).toBeInTheDocument();
    expect((await rowFor("T-003")).getByText("Not anchored")).toBeInTheDocument();
    expect((await rowFor("T-003")).getByText(/Not on the blockchain yet/)).toBeInTheDocument();
    expect((await rowFor("T-004")).getByText("Hash mismatch")).toBeInTheDocument();
    expect((await rowFor("T-004")).getByText(/Needs attention/)).toBeInTheDocument();
    expect((await rowFor("T-005")).getByRole("button", { name: "Revoke on-chain" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Revoke on-chain" })).toHaveLength(2);
  });

  it("refuses a wallet that is not the institution's registrar", async () => {
    const fetchMock = mockApi(baseRoutes([institution()]));
    connectWallet(OTHER_WALLET);
    renderAt("/UNIVA/issue_degree");
    expect(await screen.findByRole("heading", { name: "Wrong account for UNIVA" })).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("/credentials"))).toBe(false);
  });

  it("stays closed while the institution waits for HEC", async () => {
    mockApi(baseRoutes([institution({ accreditation_status: "PENDING" })]));
    connectWallet(UNIVA_WALLET);
    renderAt("/UNIVA/issue_degree");
    expect(await screen.findByRole("heading", { name: "UNIVA is waiting for HEC approval" })).toBeInTheDocument();
  });
});

/* ---------- HEC admin ---------- */

describe("HEC admin", () => {
  it("is closed to institution wallets", async () => {
    mockApi(baseRoutes());
    connectWallet(UNIVA_WALLET);
    renderAt("/admin");
    expect(await screen.findByRole("heading", { name: "HEC wallet required" })).toBeInTheDocument();
  });

  it("lists pending applications for the HEC wallet", async () => {
    mockApi(
      baseRoutes([
        institution({ code: "UNIVX", name: "Test University", accreditation_status: "PENDING" }),
        institution(),
      ]),
    );
    connectWallet(HEC_WALLET);
    renderAt("/admin");

    const pending = await screen.findByRole("heading", { name: "Pending applications" });
    const table = within(pending.closest("section") as HTMLElement);
    await waitFor(() => expect(table.getByText("Test University")).toBeInTheDocument());
    expect(table.getByRole("button", { name: "Approve" })).toBeInTheDocument();
    expect(table.getByRole("button", { name: "Reject" })).toBeInTheDocument();
    expect(table.queryByText("University A")).not.toBeInTheDocument();
  });

  it("summarises the evaluation logs", async () => {
    mockApi({
      ...baseRoutes(),
      "GET /logs": {
        body: [
          { log_id: 2, reference_code: "UNIVA-T-1", scenario_type: "TAMPERED", result: "MISMATCH_OR_NOT_FOUND", timestamp: "2026-11-12T10:00:00Z", response_time_ms: 300 },
          { log_id: 1, reference_code: "UNIVA-T-1", scenario_type: "GENUINE", result: "GENUINE_AND_ACTIVE", timestamp: "2026-11-12T09:00:00Z", response_time_ms: 100 },
        ],
      },
    });
    connectWallet(HEC_WALLET);
    signedIn(HEC_WALLET);
    renderAt("/logs");

    expect(await screen.findByText("200 ms")).toBeInTheDocument(); // average of 100 and 300
    expect(screen.getByText("Verifications logged").previousElementSibling).toHaveTextContent("2");
    expect(screen.getByText("Tampered")).toBeInTheDocument();
  });
});
