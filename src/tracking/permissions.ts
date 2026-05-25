import { PermissionsAndroid, Platform } from 'react-native';
import * as Linking from 'expo-linking';

export interface PermissionResult {
  fineLocation: boolean;
  backgroundLocation: boolean;
  activityRecognition: boolean;
  notifications: boolean;
}

const P = PermissionsAndroid.PERMISSIONS;
const FINE_LOCATION = P.ACCESS_FINE_LOCATION!;
const BG_LOCATION = P.ACCESS_BACKGROUND_LOCATION!;
const ACTIVITY = P.ACTIVITY_RECOGNITION!;
const NOTIF = P.POST_NOTIFICATIONS!;

export async function requestForegroundPermissions(): Promise<PermissionResult> {
  if (Platform.OS !== 'android') {
    return {
      fineLocation: false,
      backgroundLocation: false,
      activityRecognition: false,
      notifications: false,
    };
  }

  const fine = await PermissionsAndroid.request(FINE_LOCATION);
  const act = await PermissionsAndroid.request(ACTIVITY);
  const grantedConst: string = PermissionsAndroid.RESULTS.GRANTED ?? 'granted';
  let notif: string = grantedConst;
  if (Platform.Version >= 33) {
    notif = await PermissionsAndroid.request(NOTIF);
  }
  return {
    fineLocation: fine === PermissionsAndroid.RESULTS.GRANTED,
    backgroundLocation: false,
    activityRecognition: act === PermissionsAndroid.RESULTS.GRANTED,
    notifications: notif === PermissionsAndroid.RESULTS.GRANTED,
  };
}

export async function requestBackgroundLocation(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  if (Platform.Version < 29) return true;
  const r = await PermissionsAndroid.request(BG_LOCATION);
  return r === PermissionsAndroid.RESULTS.GRANTED;
}

export async function checkAllPermissions(): Promise<PermissionResult> {
  if (Platform.OS !== 'android') {
    return {
      fineLocation: false,
      backgroundLocation: false,
      activityRecognition: false,
      notifications: false,
    };
  }
  const fine = await PermissionsAndroid.check(FINE_LOCATION);
  const bg =
    Platform.Version >= 29 ? await PermissionsAndroid.check(BG_LOCATION) : true;
  const act = await PermissionsAndroid.check(ACTIVITY);
  const notif =
    Platform.Version >= 33 ? await PermissionsAndroid.check(NOTIF) : true;
  return {
    fineLocation: fine,
    backgroundLocation: bg,
    activityRecognition: act,
    notifications: notif,
  };
}

export function openAppSettings() {
  void Linking.openSettings();
}
