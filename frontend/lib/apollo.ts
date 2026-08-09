import { ApolloClient, InMemoryCache, HttpLink, split } from "@apollo/client";
import { GraphQLWsLink } from "@apollo/client/link/subscriptions";
import { createClient as createWsClient } from "graphql-ws";
import { getMainDefinition } from "@apollo/client/utilities";
import { nhost } from "./nhost";

function authHeaders() {
  const token = nhost.auth.getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function makeApolloClient() {
  const httpLink = new HttpLink({
    uri: nhost.graphql.getUrl(),
    headers: authHeaders(),
  });

  const wsLink =
    typeof window !== "undefined"
      ? new GraphQLWsLink(
          createWsClient({
            url: nhost.graphql.getUrl().replace(/^http/, "ws"),
            connectionParams: () => ({ headers: authHeaders() }),
          })
        )
      : null;

  const link = wsLink
    ? split(
        ({ query }) => {
          const def = getMainDefinition(query);
          return def.kind === "OperationDefinition" && def.operation === "subscription";
        },
        wsLink,
        httpLink
      )
    : httpLink;

  return new ApolloClient({ link, cache: new InMemoryCache() });
}
