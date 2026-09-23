const baseUrl = process.env.API_BASE_URL;
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!baseUrl || !token) {
  process.stderr.write(
    "API_BASE_URL and SUPABASE_ACCESS_TOKEN are required for live verification.\n",
  );
  process.exitCode = 1;
} else {
  const request = async (path) => {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}${path}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const body = await response.json();
    if (!response.ok)
      throw new Error(`${path}: ${body.error?.code ?? response.status}`);
    return body;
  };
  const health = await fetch(`${baseUrl.replace(/\/$/, "")}/api/v1/health`);
  if (!health.ok) throw new Error(`health: ${health.status}`);
  const identity = await request("/api/v1/sync/identity");
  const changes = await request("/api/v1/sync/changes?limit=1");
  process.stdout.write(
    `Live API verified for owner ${identity.data.owner_id}; change page size ${changes.data.length}.\n`,
  );
}
