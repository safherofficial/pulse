import {
  useEffect,
  useState,
  type ComponentType,
} from "react";

export function PayDesk() {
  const [
    Client,
    setClient,
  ] =
    useState<ComponentType | null>(
      null,
    );

  const [
    Trial,
    setTrial,
  ] =
    useState<ComponentType | null>(
      null,
    );

  useEffect(() => {
    let live = true;

    void Promise.all([
      import(
        "./PayClient"
      ),
      import(
        "./TrialAccessPanel"
      ),
    ]).then(
      ([
        pay,
        trial,
      ]) => {
        if (!live) {
          return;
        }

        setClient(
          () => pay.PayClient,
        );

        setTrial(
          () =>
            trial.TrialAccessPanel,
        );
      },
    );

    return () => {
      live = false;
    };
  }, []);

  if (
    !Client ||
    !Trial
  ) {
    return (
      <div className="grid gap-4">
        <div className="skeleton h-48 bg-surface" />
        <div className="skeleton h-64 bg-surface" />
      </div>
    );
  }

  return (
    <div className="grid gap-6">
      <Trial />
      <Client />
    </div>
  );
}
