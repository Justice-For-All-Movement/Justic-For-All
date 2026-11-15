"use client";
import { useState } from "react";
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";

type Summary = { passkeys: { id: string; nickname: string }[]; totp: "none" | "pending" | "active"; recoveryCodesLeft: number };

async function call(action: string, body: unknown = {}) {
  const r = await fetch(`/api/account/mfa/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return r.json().catch(() => ({ status: "error" }));
}

/** Staff security factors. Requires JavaScript (WebAuthn is a browser API). */
export function SecuritySettings({ summary }: { summary: Summary }) {
  const [message, setMessage] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [totp, setTotp] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState("");
  const say = (m: string) => setMessage(m);

  const addPasskey = async () => {
    const options = await call("register-options");
    if (!options.challenge) return say("You need to confirm it is you first (step-up), or sign in again.");
    try {
      const response = await startRegistration({ optionsJSON: options });
      const r = await call("register-verify", { response, nickname: "Passkey" });
      if (r.status === "registered") { if (r.recoveryCodes) setCodes(r.recoveryCodes); say("Passkey added."); } else say("The passkey could not be verified.");
    } catch { say("Passkey setup was cancelled."); }
  };
  const stepUpPasskey = async () => {
    const options = await call("stepup-options");
    if (!options.challenge) return say("No passkey is registered.");
    try { const r = await call("stepup-verify", { response: await startAuthentication({ optionsJSON: options }) }); say(r.status === "stepped_up" ? "Confirmed for 10 minutes." : r.status === "locked" ? "Too many attempts. Try again in 15 minutes." : "Not confirmed."); }
    catch { say("Confirmation was cancelled."); }
  };
  const beginTotp = async () => { const r = await call("totp-begin"); if (r.secret) setTotp(r); else say("Confirm it is you first (step-up), or sign in again."); };
  const confirmTotp = async () => { const r = await call("totp-confirm", { code }); if (r.status === "active") { if (r.recoveryCodes) setCodes(r.recoveryCodes); setTotp(null); say("Authenticator app enabled."); } else say(r.status === "locked" ? "Too many attempts." : "That code did not match."); };
  const stepUpCode = async (action: "totp-stepup" | "recovery-stepup") => { const r = await call(action, { code }); say(r.status === "stepped_up" ? "Confirmed for 10 minutes." : r.status === "locked" ? "Too many attempts. Try again in 15 minutes." : "That code did not work."); };

  return <div className="ui-stack">
    <p role="status" aria-live="polite">{message}</p>
    {codes ? <section aria-labelledby="codes-h" className="ui-note"><h2 id="codes-h">Save your recovery codes</h2>
      <p>Each code works once if you lose your devices. They will not be shown again.</p>
      <ul>{codes.map(c => <li key={c}><code>{c}</code></li>)}</ul></section> : null}
    <section aria-labelledby="pk-h"><h2 id="pk-h">Passkeys (recommended)</h2>
      <ul>{summary.passkeys.map(p => <li key={p.id}>{p.nickname}</li>)}</ul>
      <button className="ui-button" type="button" onClick={addPasskey}>Add a passkey</button>
    </section>
    <section aria-labelledby="totp-h"><h2 id="totp-h">Authenticator app</h2>
      <p>Status: {summary.totp === "active" ? "on" : "off"}.</p>
      {summary.totp !== "active" && !totp ? <button className="ui-button" type="button" onClick={beginTotp}>Set up an authenticator app</button> : null}
      {totp ? <div><p>Add this key to your authenticator app, then enter the 6-digit code it shows.</p><p><code>{totp.secret}</code></p><p className="ui-hint">{totp.uri}</p></div> : null}
    </section>
    <section aria-labelledby="step-h"><h2 id="step-h">Confirm it is you (step-up)</h2>
      <p>Staff actions such as publishing, withdrawing, managing roles or privacy requests need a confirmation within the last 10 minutes.</p>
      <button className="ui-button" type="button" onClick={stepUpPasskey}>Confirm with passkey</button>
      <label className="ui-label" htmlFor="mfa-code">Code from authenticator app or a recovery code</label>
      <input className="ui-input" id="mfa-code" autoComplete="one-time-code" value={code} onChange={e => setCode(e.target.value)} maxLength={19} />
      {totp ? <button className="ui-button" type="button" onClick={confirmTotp}>Turn on authenticator app</button> : <>
        <button className="ui-button" type="button" onClick={() => stepUpCode("totp-stepup")}>Confirm with app code</button>
        <button className="ui-button" type="button" onClick={() => stepUpCode("recovery-stepup")}>Use a recovery code</button></>}
      <p>Recovery codes left: {summary.recoveryCodesLeft}.</p>
    </section>
  </div>;
}
