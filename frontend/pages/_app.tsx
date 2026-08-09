import { useMemo } from "react";
import type { AppProps } from "next/app";
import { ApolloProvider } from "@apollo/client";
import { NhostProvider } from "@nhost/nhost-js/react"; // wraps auth state for hooks used below
import { nhost } from "../lib/nhost";
import { makeApolloClient } from "../lib/apollo";
import "../styles/globals.css";

export default function App({ Component, pageProps }: AppProps) {
  const client = useMemo(() => makeApolloClient(), []);
  return (
    <NhostProvider nhost={nhost}>
      <ApolloProvider client={client}>
        <Component {...pageProps} />
      </ApolloProvider>
    </NhostProvider>
  );
}
