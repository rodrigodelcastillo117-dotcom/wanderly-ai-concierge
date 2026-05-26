import { useMemo, useState } from "react";
import { Check, ChevronsUpDown, MapPin, Pencil } from "lucide-react";
import { COUNTRIES, findCountryByCity, type Country } from "@/lib/countriesCities";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface OriginPickerProps {
  value: string;
  onChange: (city: string) => void;
  className?: string;
}

/**
 * Two-step picker: País → Ciudad. Provides a free-text fallback ("Otra ciudad…")
 * so users can still enter anything outside the curated list.
 */
export function OriginPicker({ value, onChange, className }: OriginPickerProps) {
  // Derive currently selected country from the saved city.
  const initialCountry = useMemo(() => findCountryByCity(value) ?? null, [value]);
  const [country, setCountry] = useState<Country | null>(initialCountry);
  const [openCountry, setOpenCountry] = useState(false);
  const [openCity, setOpenCity] = useState(false);
  const [customMode, setCustomMode] = useState(
    !!value && !initialCountry, // value exists but isn't in the curated list
  );

  const pickCountry = (c: Country) => {
    setCountry(c);
    setOpenCountry(false);
    // Reset city when country changes; auto-open city picker.
    if (!c.cities.includes(value)) onChange("");
    setTimeout(() => setOpenCity(true), 50);
  };

  if (customMode) {
    return (
      <div className={cn("space-y-2", className)}>
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Ej. Mazatlán, Salamanca…"
          className="h-12 bg-input border-border"
          autoFocus
        />
        <button
          type="button"
          onClick={() => { setCustomMode(false); onChange(""); }}
          className="text-xs text-primary hover:underline"
        >
          ← Elegir de la lista
        </button>
      </div>
    );
  }

  return (
    <div className={cn("grid grid-cols-1 md:grid-cols-2 gap-3", className)}>
      {/* País */}
      <Popover open={openCountry} onOpenChange={setOpenCountry}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            className="h-12 justify-between bg-input border-border font-normal"
          >
            <span className="flex items-center gap-2 truncate">
              {country ? (
                <>
                  <span className="text-lg leading-none">{country.flag}</span>
                  <span className="truncate">{country.name}</span>
                </>
              ) : (
                <span className="text-muted-foreground">País de origen</span>
              )}
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 opacity-50 shrink-0" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="p-0 w-[--radix-popover-trigger-width] bg-popover border-border" align="start">
          <Command>
            <CommandInput placeholder="Buscar país…" />
            <CommandList>
              <CommandEmpty>Sin resultados.</CommandEmpty>
              <CommandGroup>
                {COUNTRIES.map((c) => (
                  <CommandItem key={c.code} value={c.name} onSelect={() => pickCountry(c)}>
                    <span className="text-lg mr-2">{c.flag}</span>
                    {c.name}
                    {country?.code === c.code && <Check className="ml-auto h-4 w-4 text-primary" />}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {/* Ciudad */}
      <Popover open={openCity} onOpenChange={setOpenCity}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            disabled={!country}
            className="h-12 justify-between bg-input border-border font-normal"
          >
            <span className="flex items-center gap-2 truncate">
              <MapPin className="h-4 w-4 text-primary shrink-0" />
              <span className={cn("truncate", !value && "text-muted-foreground")}>
                {value || "Ciudad"}
              </span>
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 opacity-50 shrink-0" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="p-0 w-[--radix-popover-trigger-width] bg-popover border-border" align="start">
          <Command>
            <CommandInput placeholder="Buscar ciudad…" />
            <CommandList>
              <CommandEmpty>Sin resultados.</CommandEmpty>
              <CommandGroup>
                {country?.cities.map((city) => (
                  <CommandItem
                    key={city}
                    value={city}
                    onSelect={() => { onChange(city); setOpenCity(false); }}
                  >
                    {city}
                    {value === city && <Check className="ml-auto h-4 w-4 text-primary" />}
                  </CommandItem>
                ))}
                <CommandItem
                  value="__custom__"
                  onSelect={() => { setOpenCity(false); setCustomMode(true); onChange(""); }}
                  className="text-primary"
                >
                  <Pencil className="h-3.5 w-3.5 mr-2" />
                  Otra ciudad…
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
