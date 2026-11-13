import type { ReviewerRecord, ReviewerRequest } from "@office-town/contract";
import { useEffect } from "react";
import { create } from "zustand";
import { api } from "../api/client.ts";
import { useApp } from "./app-store.ts";

interface ReviewState {
  // Oldest first, so the starters lead; undefined until loaded.
  reviewers: ReviewerRecord[] | undefined;
  // The task whose Send for review dialog is open, from any screen.
  reviewing: string | undefined;
}

const useReviewState = create<ReviewState>(() => ({ reviewers: undefined, reviewing: undefined }));

let loading: Promise<void> | undefined;

function loadReviewers(): Promise<void> {
  loading ??= api
    .listReviewers()
    .then((reviewers) => useReviewState.setState({ reviewers }))
    .catch((failure: unknown) => console.error("Could not load the reviewers.", failure))
    .finally(() => {
      loading = undefined;
    });
  return loading;
}

// Loaded once, then kept up to date by the saves below.
export function useReviewers(): ReviewerRecord[] | undefined {
  const reviewers = useReviewState((state) => state.reviewers);
  useEffect(() => {
    if (reviewers === undefined) void loadReviewers();
  }, [reviewers]);
  return reviewers;
}

export async function saveReviewer(
  id: string | undefined,
  request: ReviewerRequest,
): Promise<ReviewerRecord> {
  const saved =
    id === undefined ? await api.createReviewer(request) : await api.updateReviewer(id, request);
  useReviewState.setState(({ reviewers = [] }) => ({
    reviewers: reviewers.some((known) => known.id === saved.id)
      ? reviewers.map((known) => (known.id === saved.id ? saved : known))
      : [...reviewers, saved],
  }));
  return saved;
}

export async function deleteReviewer(id: string): Promise<void> {
  await api.deleteReviewer(id);
  useReviewState.setState(({ reviewers = [] }) => ({
    reviewers: reviewers.filter((known) => known.id !== id),
  }));
}

// Closes a finished agent still open, as its idle stop would (the core decides).
export async function markDone(taskId: string): Promise<void> {
  const done = await api.markReviewed(taskId);
  useApp.setState((state) => {
    const entry = state.tasks[taskId];
    return entry === undefined
      ? {}
      : { tasks: { ...state.tasks, [taskId]: { ...entry, task: done } } };
  });
}

export const openReview = (taskId: string) => useReviewState.setState({ reviewing: taskId });
export const closeReview = () => useReviewState.setState({ reviewing: undefined });
export const useReviewing = () => useReviewState((state) => state.reviewing);
