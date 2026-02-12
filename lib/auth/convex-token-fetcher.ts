export type ConvexTokenFetcherArgs = {
  forceRefreshToken: boolean;
};

type AccessTokenResolvers = {
  getAccessToken: () => Promise<string | undefined>;
  refresh: () => Promise<string | undefined>;
};

export function createConvexAuthTokenFetcher({
  getAccessToken,
  refresh,
}: AccessTokenResolvers) {
  return async ({ forceRefreshToken }: ConvexTokenFetcherArgs): Promise<string | null> => {
    try {
      const token = forceRefreshToken
        ? await refresh()
        : await getAccessToken();
      return token ?? null;
    } catch {
      return null;
    }
  };
}
