import React from "react";
import { NavigationContainer, DarkTheme } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import HomeScreen from "./src/screens/HomeScreen";
import TuneScreen from "./src/screens/TuneScreen";
import FlashScreen from "./src/screens/FlashScreen";
import EditVehicleScreen from "./src/screens/EditVehicleScreen";
import ProTablesScreen from "./src/screens/ProTablesScreen";
import ProSettingsScreen from "./src/screens/ProSettingsScreen";
import CaptureScreen from "./src/screens/CaptureScreen";
import TuneSpecScreen from "./src/screens/TuneSpecScreen";
import DiagnosticsScreen from "./src/screens/DiagnosticsScreen";
import { CarTuneProvider } from "./src/state/CarTuneContext";
import { useAutoDetect } from "./src/vehicle/useAutoDetect";
import { PRESETS } from "./src/tune/presets";

const Stack = createNativeStackNavigator();

function Screens() {
  useAutoDetect();
  return (
    <Stack.Navigator screenOptions={{ headerStyle: { backgroundColor: "#181d23" }, headerTintColor: "#eaeef2" }}>
      <Stack.Screen name="Home" component={HomeScreen} options={{ title: "CarTune" }} />
      <Stack.Screen name="Tune" component={TuneScreen}
        options={({ route }: any) => ({ title: PRESETS.find((p) => p.id === route.params?.presetId)?.name ?? "Tune" })} />
      <Stack.Screen name="ProTables" component={ProTablesScreen} options={{ title: "Pro tables" }} />
      <Stack.Screen name="ProSettings" component={ProSettingsScreen} options={{ title: "Pro settings" }} />
      <Stack.Screen name="Flash" component={FlashScreen} options={{ title: "Flash", presentation: "modal" }} />
      <Stack.Screen name="EditVehicle" component={EditVehicleScreen} options={{ title: "Vehicle details", presentation: "modal" }} />
      <Stack.Screen name="Capture" component={CaptureScreen} options={{ title: "Live data" }} />
      <Stack.Screen name="Diagnostics" component={DiagnosticsScreen} options={{ title: "Diagnostics" }} />
      <Stack.Screen name="TuneSpec" component={TuneSpecScreen} options={{ title: "Tune spec (advanced)" }} />
    </Stack.Navigator>
  );
}

export default function App() {
  return (
    <CarTuneProvider>
      <NavigationContainer theme={DarkTheme}>
        <Screens />
      </NavigationContainer>
    </CarTuneProvider>
  );
}
