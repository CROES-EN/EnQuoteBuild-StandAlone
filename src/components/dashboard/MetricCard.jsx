import { Card } from "@/components/ui/card";
import { motion } from "framer-motion";
import { ArrowUp, ArrowDown, Minus } from "lucide-react";
import { Link } from "react-router-dom";

export default function MetricCard({ title, value, subtitle, icon: Icon, trend, index = 0, href, iconBg }) {
  const getTrendIcon = () => {
    if (!trend) return null;
    if (trend > 0) return <ArrowUp className="w-4 h-4 text-green-600" />;
    if (trend < 0) return <ArrowDown className="w-4 h-4 text-red-600" />;
    return <Minus className="w-4 h-4 text-slate-400" />;
  };

  const getTrendColor = () => {
    if (trend > 0) return "text-green-600";
    if (trend < 0) return "text-red-600";
    return "text-slate-400";
  };

  const CardContent = (
    <Card className={`p-6 border-slate-200 hover:shadow-lg transition-all ${href ? 'cursor-pointer hover:border-indigo-300' : ''}`}>
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-sm text-slate-600 mb-1">{title}</p>
          <p className="text-3xl font-bold text-slate-900">{value}</p>
          {subtitle && (
            <p className="text-sm text-slate-500 mt-1">{subtitle}</p>
          )}
          {trend !== undefined && (
            <div className={`flex items-center gap-1 mt-2 text-sm font-medium ${getTrendColor()}`}>
              {getTrendIcon()}
              <span>{Math.abs(trend)}%</span>
            </div>
          )}
        </div>
        {Icon && (
          <div className={`w-12 h-12 rounded-xl flex items-center justify-center shadow-lg ${iconBg || "bg-gradient-to-br from-indigo-500 to-violet-600 shadow-indigo-200"}`}>
            <Icon className="w-6 h-6 text-white" />
          </div>
        )}
      </div>
    </Card>
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.1 }}
    >
      {href ? (
        <Link to={href}>
          {CardContent}
        </Link>
      ) : (
        CardContent
      )}
    </motion.div>
  );
}