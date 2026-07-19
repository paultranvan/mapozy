// Custom entry: register the background pipeline headless task BEFORE handing
// over to expo-router. The native tracker starts this task at each
// MOVING→STATIONARY transition (PipelineHeadlessTaskService) so trips get
// segmented even when the OS killed the app process; in that case only the
// bundle runs — no UI mounts — and this registration is all that exists.
import { AppRegistry } from 'react-native';
import {
  HEADLESS_PIPELINE_TASK,
  headlessPipelineTask,
} from './src/tracking/headlessPipelineTask';
import 'expo-router/entry';

AppRegistry.registerHeadlessTask(HEADLESS_PIPELINE_TASK, () => headlessPipelineTask);
