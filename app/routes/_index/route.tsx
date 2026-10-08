import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";

import styles from "./styles.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return null;
};

// Shown to anyone who reaches the app outside the Shopify admin. No shop
// domain form: installs and logins start from Shopify, never from here.
export default function App() {
  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>StoreRx</h1>
        <p className={styles.text}>
          A check-up for your Shopify store: what is costing you sales, and how to solve it.
        </p>
        <p className={styles.note}>
          StoreRx runs inside Shopify. To use it, open it from the Apps section of your Shopify admin.
        </p>
        <ul className={styles.list}>
          <li>
            <strong>Area-by-area scans</strong>. Home, collection, product and cart pages, plus speed,
            SEO and catalog images, each scored.
          </li>
          <li>
            <strong>Every issue explained</strong>. What was found, why it matters, and where in
            Shopify you solve it.
          </li>
          <li>
            <strong>Copy drafted on request</strong>. SEO titles, descriptions and alt text you review
            and approve before anything changes.
          </li>
        </ul>
      </div>
    </div>
  );
}
