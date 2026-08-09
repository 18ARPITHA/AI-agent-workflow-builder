import { useMemo } from "react";
import type { AppProps } from "next/app";
import { ApolloProvider } from "@apollo/client";
import { makeApolloClient } from "../lib/apollo";
import "../styles/globals.css";

export default function App({ Component, pageProps }: AppProps) {
  const client = useMemo(() => makeApolloClient(), []);
  return (
    <ApolloProvider client={client}>
      <Component {...pageProps} />
    </ApolloProvider>
  );
}
