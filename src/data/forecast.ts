import type { HomeAssistant } from "custom-card-helpers";
import type { UnsubscribeFunc } from "home-assistant-js-websocket";
import type { StatisticValue } from "./statistics";
import type { EnergyCustomGraphWeatherForecastType } from "../types";

const UNIT_MS: Record<string, number> = {
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
  w: 7 * 24 * 60 * 60 * 1000,
};

const HOUR_MS = 60 * 60 * 1000;

/**
 * Parse a simple duration string ("48h", "7d", "90m", "1w") into milliseconds.
 * Supported units: s(econds), m(inutes), h(ours), d(ays), w(eeks). Returns
 * undefined when the input is missing or malformed.
 */
export const parseDurationToMs = (input?: string): number | undefined => {
  if (typeof input !== "string") {
    return undefined;
  }
  const match = input.trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*(s|m|h|d|w)$/);
  if (!match) {
    return undefined;
  }
  const amount = Number(match[1]);
  const unit = UNIT_MS[match[2]];
  if (!Number.isFinite(amount) || amount <= 0 || !unit) {
    return undefined;
  }
  return amount * unit;
};

/**
 * A single item as returned by the `weather/subscribe_forecast` websocket
 * command. Only a subset of fields is typed explicitly; the index signature
 * covers any additional forecast attribute a weather integration may expose.
 */
export interface WeatherForecastItem {
  datetime: string;
  condition?: string;
  temperature?: number | null;
  templow?: number | null;
  apparent_temperature?: number | null;
  dew_point?: number | null;
  pressure?: number | null;
  humidity?: number | null;
  wind_speed?: number | null;
  wind_gust_speed?: number | null;
  wind_bearing?: number | string | null;
  cloud_coverage?: number | null;
  precipitation?: number | null;
  precipitation_probability?: number | null;
  uv_index?: number | null;
  ozone?: number | null;
  visibility?: number | null;
  [key: string]: unknown;
}

export interface WeatherForecastEvent {
  type?: string;
  forecast?: WeatherForecastItem[];
}

/**
 * Subscribe to a weather entity's forecast via the stable websocket command
 * (the same one the native weather-forecast card uses). The callback receives
 * an event whose `forecast` field is the array of forecast items.
 */
export const subscribeWeatherForecast = (
  hass: HomeAssistant,
  entityId: string,
  forecastType: EnergyCustomGraphWeatherForecastType,
  callback: (event: WeatherForecastEvent) => void
): Promise<UnsubscribeFunc> =>
  hass.connection.subscribeMessage<WeatherForecastEvent>(callback, {
    type: "weather/subscribe_forecast",
    forecast_type: forecastType,
    entity_id: entityId,
  });

export interface ForecastPoint {
  timestamp: number;
  value: number;
}

export interface ForecastFilterOptions {
  /** Drop points before this timestamp (now-forward filtering). */
  now?: number;
  /** Drop points before this timestamp (display window start). */
  rangeStart?: number | null;
  /** Drop points after this timestamp (display window / horizon end). */
  rangeEnd?: number | null;
}

/**
 * Shared filter for forecast points: keeps only finite, now-forward points that
 * fall inside the optional [rangeStart, rangeEnd] window, sorted ascending.
 */
export const filterForecastPoints = (
  points: ForecastPoint[],
  options: ForecastFilterOptions = {}
): ForecastPoint[] => {
  const { now, rangeStart, rangeEnd } = options;
  return points
    .filter((point) => {
      if (!Number.isFinite(point.timestamp) || !Number.isFinite(point.value)) {
        return false;
      }
      if (now !== undefined && point.timestamp < now) {
        return false;
      }
      if (rangeStart != null && point.timestamp < rangeStart) {
        return false;
      }
      if (rangeEnd != null && point.timestamp > rangeEnd) {
        return false;
      }
      return true;
    })
    .sort((a, b) => a.timestamp - b.timestamp);
};

/**
 * Map raw weather forecast items to `[timestamp, value]` points for a single
 * attribute. Non-numeric attribute values become NaN and are dropped by
 * {@link filterForecastPoints}.
 */
export const weatherForecastToPoints = (
  forecast: WeatherForecastItem[],
  attribute: string
): ForecastPoint[] =>
  forecast
    .map((item) => {
      const timestamp = new Date(item.datetime).getTime();
      const rawValue = item[attribute];
      const value = typeof rawValue === "number" ? rawValue : Number(rawValue);
      return { timestamp, value };
    })
    .filter((point) => Number.isFinite(point.timestamp));

/**
 * Convert forecast points into `StatisticValue[]` so they flow through the same
 * series-building pipeline as statistics. Every stat field carries the same
 * value, so any configured `stat_type` resolves to it.
 */
export const pointsToStatisticValues = (
  points: ForecastPoint[],
  intervalMs: number = HOUR_MS
): StatisticValue[] =>
  points.map(({ timestamp, value }) => ({
    start: timestamp,
    end: timestamp + intervalMs,
    change: value,
    sum: value,
    mean: value,
    min: value,
    max: value,
    state: value,
  }));

/** Nominal spacing between forecast items for each forecast type. */
export const forecastTypeIntervalMs = (
  forecastType: EnergyCustomGraphWeatherForecastType
): number => {
  switch (forecastType) {
    case "daily":
      return 24 * 60 * 60 * 1000;
    case "twice_daily":
      return 12 * 60 * 60 * 1000;
    case "hourly":
    default:
      return HOUR_MS;
  }
};

const PERCENT_ATTRIBUTES = new Set([
  "humidity",
  "cloud_coverage",
  "precipitation_probability",
]);

const UNIT_ATTRIBUTE_BY_FIELD: Record<string, string> = {
  temperature: "temperature_unit",
  templow: "temperature_unit",
  apparent_temperature: "temperature_unit",
  dew_point: "temperature_unit",
  pressure: "pressure_unit",
  wind_speed: "wind_speed_unit",
  wind_gust_speed: "wind_speed_unit",
  precipitation: "precipitation_unit",
  visibility: "visibility_unit",
};

/**
 * Best-effort unit for a weather attribute, derived from the weather entity's
 * `*_unit` attributes. Returns undefined when unknown, letting an explicit axis
 * unit take over.
 */
export const weatherAttributeUnit = (
  attributes: Record<string, unknown> | undefined,
  attribute: string
): string | undefined => {
  if (PERCENT_ATTRIBUTES.has(attribute)) {
    return "%";
  }
  if (!attributes) {
    return undefined;
  }
  const unitKey = UNIT_ATTRIBUTE_BY_FIELD[attribute];
  const unit = unitKey ? attributes[unitKey] : undefined;
  return typeof unit === "string" ? unit : undefined;
};
