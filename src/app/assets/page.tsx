import {
  CashAndPrevForm,
  DeleteDepositButton,
  DepositForm,
  MortgageForm,
} from "@/components/assets/asset-forms";
import { Money } from "@/components/money";
import { Band, JumpLink, PageHeader } from "@/components/region";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getCash, getMortgage, listDeposits } from "@/server/ledger";

export const dynamic = "force-dynamic";

export default function AssetsPage() {
  const deposits = listDeposits();
  const mortgage = getMortgage();
  const cash = getCash();

  return (
    <>
      <PageHeader title="存款和房贷" lead="维护存款、房贷与现金。" />

      <div className="assets-layout">
        <Band label="存款">
          {deposits.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>银行</TableHead>
                  <TableHead>本金</TableHead>
                  <TableHead>到期</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {deposits.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>{row.bank}</TableCell>
                    <TableCell>
                      <Money value={row.principal} />
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {row.maturityDate ?? "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <DepositForm initial={row} />
                      <DeleteDepositButton id={row.id} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : null}
          <div className={deposits.length > 0 ? "mt-4" : undefined}>
            <DepositForm />
          </div>
        </Band>

        <Band label="房贷">
          <MortgageForm initial={mortgage} />
        </Band>

        <Band label="现金">
          <CashAndPrevForm cash={cash} />
        </Band>

        <p>
          <JumpLink href="/dca">返回定投管理</JumpLink>
        </p>
      </div>
    </>
  );
}
