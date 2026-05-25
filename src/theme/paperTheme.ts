import { MD3LightTheme, MD3DarkTheme, type MD3Theme } from 'react-native-paper';

const PRIMARY = '#2A9D8F';
const SECONDARY = '#E76F51';

export const lightTheme: MD3Theme = {
  ...MD3LightTheme,
  colors: {
    ...MD3LightTheme.colors,
    primary: PRIMARY,
    secondary: SECONDARY,
  },
};

export const darkTheme: MD3Theme = {
  ...MD3DarkTheme,
  colors: {
    ...MD3DarkTheme.colors,
    primary: PRIMARY,
    secondary: SECONDARY,
  },
};
