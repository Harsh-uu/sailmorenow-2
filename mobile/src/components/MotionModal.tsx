import React from "react";
import { Modal, ModalProps } from "react-native";
import { useReducedMotion } from "@/src/hooks/useReducedMotion";

/**
 * Drop-in replacement for React Native's <Modal> that respects the OS
 * "Reduce Motion" setting: when reduce-motion is on, the slide/fade
 * presentation animation is disabled (animationType="none"). Otherwise it
 * honours whatever animationType the caller passed (default "slide").
 */
export function MotionModal(props: ModalProps) {
  const reduced = useReducedMotion();
  const animationType = reduced ? "none" : props.animationType ?? "slide";
  return <Modal {...props} animationType={animationType} />;
}
