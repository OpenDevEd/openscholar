"use node";

const timeout = () => AbortSignal.timeout(15_000);

export async function verifyCrossrefCredentials(
  loginId: string,
  password: string,
  sandbox: boolean,
) {
  const url = new URL(
    "/servlet/login",
    sandbox ? "https://test.crossref.org" : "https://doi.crossref.org",
  );
  const separator = Math.max(
    loginId.lastIndexOf("/"),
    loginId.lastIndexOf(":"),
  );
  url.searchParams.set(
    "usr",
    separator > -1 ? loginId.slice(0, separator) : loginId,
  );
  url.searchParams.set("pwd", password);
  if (separator > -1)
    url.searchParams.set("role", loginId.slice(separator + 1));
  // Crossref's login servlet authenticates the deposit role, unlike its public metadata API.
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: timeout(),
    redirect: "error",
  });
  const data = await response.json().catch(() => null);
  if (
    !response.ok ||
    data?.authenticated !== true ||
    data?.authorised !== true
  ) {
    console.error("Publishing credential verification rejected", {
      provider: "crossref",
      operation: "login",
      sandbox,
      status: response.status,
      authenticated: data?.authenticated,
      authorised: data?.authorised,
    });
    throw new Error(
      "Crossref could not verify this login and deposit role. Check the credentials and try again.",
    );
  }
}

export async function verifyZenodoCredentials(token: string, sandbox: boolean) {
  const base = sandbox ? "https://sandbox.zenodo.org" : "https://zenodo.org";
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  // An empty private draft verifies deposit:write without uploading or publishing anything.
  const created = await fetch(`${base}/api/deposit/depositions`, {
    method: "POST",
    headers,
    body: "{}",
    signal: timeout(),
    redirect: "error",
  });
  if (created.status !== 201) {
    const contentType = created.headers.get("content-type") ?? "";
    const body = await created.text();
    console.error("Publishing credential verification rejected", {
      provider: "zenodo",
      operation: "create-draft",
      sandbox,
      status: created.status,
      contentType,
      response: body.slice(0, 500),
    });
    if (created.status === 429)
      throw new Error(
        "Zenodo is rate limiting requests. Try again later. Nothing was saved.",
      );
    if (contentType.includes("text/html"))
      throw new Error(
        "Zenodo blocked the verification request. Try again later. Nothing was saved.",
      );
    throw new Error(
      "Zenodo could not create a draft. Check the token has deposit:write permission.",
    );
  }
  const draft = await created.json();
  if (!Number.isSafeInteger(draft.id) || draft.id < 1)
    throw new Error("Zenodo returned an invalid draft response. Try again.");
  const url = `${base}/api/deposit/depositions/${draft.id}`;
  try {
    // Edit requires deposit:actions. A new draft cannot enter the published-record edit
    // state, so authorized requests return 400. No publish request is ever made.
    const action = await fetch(`${url}/actions/edit`, {
      method: "POST",
      headers,
      signal: timeout(),
      redirect: "error",
    });
    const data = await action.json().catch(() => null);
    if (
      !(
        action.status === 201 ||
        (action.status === 400 && data?.status === 400)
      )
    )
      throw new Error(
        "Zenodo could not verify deposit:actions permission. Enable it on the token and try again.",
      );
  } finally {
    const removed = await fetch(url, {
      method: "DELETE",
      headers,
      signal: timeout(),
      redirect: "error",
    });
    if (removed.status !== 204)
      throw new Error(
        `Zenodo could not remove verification draft ${draft.id}. Remove it in Zenodo and try again.`,
      );
  }
}
