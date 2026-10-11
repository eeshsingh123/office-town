import { create } from "zustand";

export const useCommandMenu = create<{ open: boolean }>(() => ({ open: false }));

export const setCommandMenuOpen = (open: boolean) => useCommandMenu.setState({ open });

export const openCommandMenu = () => setCommandMenuOpen(true);
