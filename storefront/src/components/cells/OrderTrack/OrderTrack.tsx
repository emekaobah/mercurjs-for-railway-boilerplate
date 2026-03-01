import { Card } from "@/components/atoms"

export const OrderTrack = ({ order }: { order: any }) => {
  if (!order.fulfillments[0]?.labels?.length) return null

  const labels = order.fulfillments[0]?.labels

  return (
    <div>
      <h2 className="text-primary label-lg uppercase">Order Tracking</h2>
      <ul className="mt-4">
        {labels.map((item: any) => (
          <li key={item.id}>
            {item.tracking_url ? (
              <a
                href={item.tracking_url}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Card className="px-4 hover:bg-secondary/30">
                  {item.tracking_number}
                </Card>
              </a>
            ) : (
              <Card className="px-4">{item.tracking_number}</Card>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
