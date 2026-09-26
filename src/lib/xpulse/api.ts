import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";

export const getBillingConfig =
  createServerFn({
    method: "GET",
  }).handler(async () => {
    const {
      billingConfig,
    } = await import(
      "./data.server"
    );

    return billingConfig();
  });

export const issueLoginNonce =
  createServerFn({
    method: "POST",
  }).handler(async () => {
    const {
      runIssueLoginNonce,
    } = await import(
      "./data.server"
    );

    return runIssueLoginNonce();
  });

export const loginWithWallet =
  createServerFn({
    method: "POST",
  })
    .validator(
      (input: unknown) =>
        input,
    )
    .handler(
      async ({
        data,
      }) => {
        const {
          runLoginWithWallet,
        } = await import(
          "./data.server"
        );

        return runLoginWithWallet(
          data,
        );
      },
    );

export const getMe =
  createServerFn({
    method: "GET",
  })
    .middleware([
      authMiddleware,
    ])
    .handler(
      async ({
        context,
      }) => {
        const {
          runMe,
        } = await import(
          "./data.server"
        );

        return runMe(
          context.userId,
        );
      },
    );

export const issueNonce =
  createServerFn({
    method: "POST",
  })
    .middleware([
      authMiddleware,
    ])
    .handler(
      async ({
        context,
      }) => {
        const {
          runIssueNonce,
        } = await import(
          "./data.server"
        );

        return runIssueNonce(
          context.userId,
        );
      },
    );

export const connectWallet =
  createServerFn({
    method: "POST",
  })
    .middleware([
      authMiddleware,
    ])
    .validator(
      (input: unknown) =>
        input,
    )
    .handler(
      async ({
        context,
        data,
      }) => {
        const {
          runConnectWallet,
        } = await import(
          "./data.server"
        );

        return runConnectWallet(
          context.userId,
          data,
        );
      },
    );

export const startTrial =
  createServerFn({
    method: "POST",
  })
    .middleware([
      authMiddleware,
    ])
    .handler(
      async ({
        context,
      }) => {
        const {
          runStartTrial,
        } = await import(
          "./data.server"
        );

        return runStartTrial(
          context.userId,
        );
      },
    );

export const verifyPayment =
  createServerFn({
    method: "POST",
  })
    .middleware([
      authMiddleware,
    ])
    .validator(
      (input: unknown) =>
        input,
    )
    .handler(
      async ({
        context,
        data,
      }) => {
        const {
          runVerifyPayment,
        } = await import(
          "./data.server"
        );

        return runVerifyPayment(
          context.userId,
          data,
        );
      },
    );

export const getOverview =
  createServerFn({
    method: "GET",
  })
    .middleware([
      authMiddleware,
    ])
    .handler(
      async ({
        context,
      }) => {
        const {
          runOverview,
        } = await import(
          "./data.server"
        );

        return runOverview(
          context.userId,
        );
      },
    );

export const getHeatmap =
  createServerFn({
    method: "GET",
  })
    .middleware([
      authMiddleware,
    ])
    .handler(
      async ({
        context,
      }) => {
        const {
          runHeatmap,
        } = await import(
          "./data.server"
        );

        return runHeatmap(
          context.userId,
        );
      },
    );

export const getPost =
  createServerFn({
    method: "GET",
  })
    .middleware([
      authMiddleware,
    ])
    .validator(
      (input: unknown) =>
        input,
    )
    .handler(
      async ({
        context,
        data,
      }) => {
        const {
          runPost,
        } = await import(
          "./data.server"
        );

        return runPost(
          context.userId,
          data,
        );
      },
    );

export const importPost =
  createServerFn({
    method: "POST",
  })
    .middleware([
      authMiddleware,
    ])
    .validator(
      (input: unknown) =>
        input,
    )
    .handler(
      async ({
        context,
        data,
      }) => {
        const {
          runImport,
        } = await import(
          "./data.server"
        );

        return runImport(
          context.userId,
          data,
        );
      },
    );

export const linkThread =
  createServerFn({
    method: "POST",
  })
    .middleware([
      authMiddleware,
    ])
    .validator(
      (input: unknown) =>
        input,
    )
    .handler(
      async ({
        context,
        data,
      }) => {
        const {
          runLink,
        } = await import(
          "./data.server"
        );

        return runLink(
          context.userId,
          data,
        );
      },
    );

export const syncPosts =
  createServerFn({
    method: "POST",
  })
    .middleware([
      authMiddleware,
    ])
    .handler(
      async ({
        context,
      }) => {
        const {
          runSync,
        } = await import(
          "./data.server"
        );

        return runSync(
          context.userId,
        );
      },
    );

export const beginXConnect =
  createServerFn({
    method: "POST",
  })
    .middleware([
      authMiddleware,
    ])
    .handler(
      async ({
        context,
      }) => {
        const {
          runBeginX,
        } = await import(
          "./data.server"
        );

        return runBeginX(
          context.userId,
        );
      },
    );

export const compareXUrls = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(async ({ data }) => {
    const { runCompareXUrls } = await import("./data.server");
    return runCompareXUrls(data);
  });

export const importFromXUrl =
  createServerFn({
    method: "POST",
  })
    .middleware([
      authMiddleware,
    ])
    .validator(
      (input: unknown) =>
        input,
    )
    .handler(
      async ({
        context,
        data,
      }) => {
        const {
          runImportFromXUrl,
        } = await import(
          "./data.server"
        );

        return runImportFromXUrl(
          context.userId,
          data,
        );
      },
    );
