import { NativeModule, requireNativeModule } from 'expo';
import type { EventSubscription } from 'expo-modules-core';
import type {
  TrackingConfig,
  TrackingStatus,
  LocationUpdate,
  ActivityUpdate,
  ActivityType,
} from './MapozyTracker.types';

interface MapozyTrackerEvents {
  onLocation: (event: LocationUpdate) => void;
  onActivity: (event: ActivityUpdate) => void;
}

declare class MapozyTrackerNativeModule extends NativeModule<MapozyTrackerEvents> {
  start(config: TrackingConfig): Promise<void>;
  stop(): Promise<void>;
  isTracking(): Promise<boolean>;
  getStatus(): Promise<TrackingStatus>;
}

const Native = requireNativeModule<MapozyTrackerNativeModule>('MapozyTracker');

export const MapozyTracker = {
  start: (cfg: TrackingConfig) => Native.start(cfg),
  stop: () => Native.stop(),
  isTracking: () => Native.isTracking(),
  getStatus: () => Native.getStatus(),
  addLocationListener: (cb: (l: LocationUpdate) => void): EventSubscription =>
    Native.addListener('onLocation', cb),
  addActivityListener: (cb: (a: ActivityUpdate) => void): EventSubscription =>
    Native.addListener('onActivity', cb),
};

export type {
  TrackingConfig,
  TrackingStatus,
  LocationUpdate,
  ActivityUpdate,
  ActivityType,
};
