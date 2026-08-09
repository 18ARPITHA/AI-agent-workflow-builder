import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { useQuery, gql } from "@apollo/client";
import { nhost } from "../lib/nhost";

const MY_ORGS = gql`
  query MyOrgs {
    org_members {
      org_id
      role
      org {
        id
        name
      }
    }
  }
`;

export default function Home() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    setSignedIn(nhost.auth.isAuthenticated());
   const unsubscribe = nhost.auth.onAuthStateChanged((_event, session) => {
      setSignedIn(!!session);
    });
    return () => unsubscribe();
  }, []);

  const { data, loading } = useQuery(MY_ORGS, { skip: !signedIn });

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const { error } = await nhost.auth.signIn({ email, password });
    if (error) setError(error.message);
  }

  if (!signedIn) {
    return (
      <div style={{ maxWidth: 360, margin: "80px auto" }} className="card">
        <h2>Sign in</h2>
        <form onSubmit={handleSignIn} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <input placeholder="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input
            placeholder="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error && <div style={{ color: "#ff7c7c" }}>{error}</div>}
          <button className="btn" type="submit">
            Sign in
          </button>
        </form>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 480, margin: "80px auto" }}>
      <h2>Your organizations</h2>
      {loading && <p>Loading…</p>}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {data?.org_members?.map((m: any) => (
          <div key={m.org_id} className="card" style={{ display: "flex", justifyContent: "space-between" }}>
            <div>
              {m.org.name} <span style={{ opacity: 0.6 }}>({m.role})</span>
            </div>
            <button className="btn secondary" onClick={() => router.push(`/org/${m.org_id}/workflows`)}>
              Open
            </button>
          </div>
        ))}
      </div>
      <button className="btn secondary" style={{ marginTop: 20 }} onClick={() => nhost.auth.signOut()}>
        Sign out
      </button>
    </div>
  );
}
