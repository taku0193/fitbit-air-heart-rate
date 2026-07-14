export const GOOGLE_HEALTH_SCOPE = 'https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly';
export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const HEART_RATE_URL = 'https://health.googleapis.com/v4/users/me/dataTypes/heart-rate/dataPoints';

export class GoogleHealthError extends Error {
  constructor(message, code, status = 500, retryAfter = null) {
    super(message);
    this.name = 'GoogleHealthError';
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

export class GoogleHealthClient {
  constructor(config, fetchImpl = globalThis.fetch) {
    this.config = config;
    this.fetch = fetchImpl;
    this.accessToken = null;
    this.accessTokenExpiresAt = 0;
    this.refreshToken = config.refreshToken || null;
  }

  get configured() {
    return Boolean(this.config.clientId && this.config.clientSecret && this.config.redirectUri);
  }

  get authorized() {
    return Boolean(this.refreshToken || (this.accessToken && Date.now() < this.accessTokenExpiresAt));
  }

  authorizationUrl(state) {
    if (!this.configured) throw new GoogleHealthError('Google Health APIのOAuth設定がありません。', 'not_configured', 503);
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: 'code',
      access_type: 'offline',
      prompt: 'consent',
      scope: GOOGLE_HEALTH_SCOPE,
      state
    });
    return `${GOOGLE_AUTH_URL}?${params}`;
  }

  async exchangeCode(code) {
    const token = await this.requestToken({
      code,
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      redirect_uri: this.config.redirectUri,
      grant_type: 'authorization_code'
    });
    this.applyToken(token);
  }

  async refreshAccessToken() {
    if (!this.refreshToken) throw new GoogleHealthError('Google Health APIの認証が必要です。', 'not_authorized', 401);
    const token = await this.requestToken({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      refresh_token: this.refreshToken,
      grant_type: 'refresh_token'
    });
    this.applyToken(token);
    return this.accessToken;
  }

  async requestToken(fields) {
    let response;
    try {
      response = await this.fetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(fields),
        signal: AbortSignal.timeout(10_000)
      });
    } catch (error) {
      throw new GoogleHealthError('OAuthトークンサーバーへ接続できません。', 'oauth_network_error', 502);
    }
    if (!response.ok) {
      throw new GoogleHealthError('OAuth認証またはトークン更新に失敗しました。再認証してください。', 'oauth_error', response.status);
    }
    return response.json();
  }

  applyToken(token) {
    if (!token.access_token) throw new GoogleHealthError('OAuthレスポンスにアクセストークンがありません。', 'oauth_invalid_response', 502);
    this.accessToken = token.access_token;
    this.accessTokenExpiresAt = Date.now() + Math.max(0, Number(token.expires_in ?? 3600) - 60) * 1000;
    if (token.refresh_token) this.refreshToken = token.refresh_token;
  }

  async getAccessToken(forceRefresh = false) {
    if (!forceRefresh && this.accessToken && Date.now() < this.accessTokenExpiresAt) return this.accessToken;
    return this.refreshAccessToken();
  }

  async latestHeartRate(now = new Date()) {
    let token = await this.getAccessToken();
    let response = await this.fetchHeartRate(token, now);
    if (response.status === 401 && this.refreshToken) {
      token = await this.getAccessToken(true);
      response = await this.fetchHeartRate(token, now);
    }
    if (response.status === 429) {
      throw new GoogleHealthError('Google Health APIのレート制限に達しました。しばらく待ってください。', 'rate_limited', 429, response.headers.get('retry-after'));
    }
    if (response.status === 401 || response.status === 403) {
      throw new GoogleHealthError('Google Health APIの認証または権限を確認してください。', 'api_unauthorized', response.status);
    }
    if (!response.ok) throw new GoogleHealthError('Google Health APIから心拍数を取得できませんでした。', 'api_error', response.status);

    const payload = await response.json();
    const point = payload.dataPoints?.find(item => item?.heartRate?.sampleTime?.physicalTime && item?.heartRate?.beatsPerMinute !== undefined);
    if (!point) return null;
    const bpm = Number(point.heartRate.beatsPerMinute);
    if (!Number.isInteger(bpm) || bpm < 1 || bpm > 300) {
      throw new GoogleHealthError('Google Health APIが不正な心拍数を返しました。', 'invalid_api_data', 502);
    }
    return {
      bpm,
      measuredAt: point.heartRate.sampleTime.physicalTime,
      receivedAt: new Date().toISOString(),
      source: 'cloud-api'
    };
  }

  async fetchHeartRate(token, now) {
    const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const params = new URLSearchParams({
      pageSize: '1',
      filter: `heart_rate.sample_time.physical_time >= "${since}"`
    });
    try {
      return await this.fetch(`${HEART_RATE_URL}?${params}`, {
        headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
        signal: AbortSignal.timeout(10_000)
      });
    } catch (error) {
      throw new GoogleHealthError('Google Health APIへ接続できません。', 'api_network_error', 502);
    }
  }

  clearTokens() {
    this.accessToken = null;
    this.accessTokenExpiresAt = 0;
    this.refreshToken = this.config.refreshToken || null;
  }
}
