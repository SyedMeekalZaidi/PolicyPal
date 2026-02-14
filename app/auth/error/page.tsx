import { Suspense } from "react";

async function ErrorContent({
  searchParams,
}: {
  searchParams: Promise<{ error: string }>;
}) {
  const params = await searchParams;

  return (
    <>
      {params?.error ? (
        <p className="text-sm text-muted-foreground">
          Error: {params.error}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          An unspecified error occurred.
        </p>
      )}
    </>
  );
}

export default function Page({
  searchParams,
}: {
  searchParams: Promise<{ error: string }>;
}) {
  return (
    <div className="flex flex-col gap-6 text-center">
      <div>
        <h2 className="text-2xl font-bold text-foreground mb-2">
          Sorry, something went wrong.
        </h2>
      </div>
      <Suspense>
        <ErrorContent searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
