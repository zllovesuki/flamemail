import { Route, Routes } from "react-router-dom";
import { AppShell } from "@/client/components/app-shell";
import { About } from "@/client/components/About";
import { AdminLogin } from "@/client/components/AdminLogin";
import { ExternalLinkRedirect } from "@/client/components/ExternalLinkRedirect";
import { HomePage, InboxPage } from "@/client/pages";

export const App = () => (
  <Routes>
    <Route element={<AppShell />}>
      <Route path="/" element={<HomePage />} />
      <Route path="/about" element={<About />} />
      <Route path="/admin" element={<AdminLogin />} />
      <Route path="/link" element={<ExternalLinkRedirect />} />
      <Route path="/inbox/:address" element={<InboxPage />} />
    </Route>
  </Routes>
);
