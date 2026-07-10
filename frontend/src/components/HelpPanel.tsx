import { useState } from "react";
import "./HelpPanel.css";

interface HelpPanelProps {
  open: boolean;
  showFab?: boolean;
  onOpen: () => void;
  onClose: () => void;
}

type HelpTab = "map" | "field" | "background" | "study";

const TAB_LABELS: Record<HelpTab, string> = {
  map: "Using the map",
  field: "Measurements",
  background: "Background",
  study: "This study",
};

const SPICEBUSH_IMAGES = {
  bushSummer: "/images/spicebush/spicebush-summer.png",
  bushFall: "/images/spicebush/spicebush-fall.png",
  rangeMap: "/images/spicebush/range-map.png",
  leaves: "/images/spicebush/leaves.jpg",
  bark: "/images/spicebush/bark.jpg",
  flowers: "/images/spicebush/flowers.jpg",
  fruit: "/images/spicebush/fruit.jpg",
} as const;

export default function HelpPanel({
  open,
  showFab = true,
  onClose,
  onOpen,
}: HelpPanelProps) {
  const [activeTab, setActiveTab] = useState<HelpTab>("map");

  if (!open) {
    if (!showFab) {
      return null;
    }

    return (
      <button
        type="button"
        className="help-panel__fab"
        onClick={onOpen}
        aria-label="Introduction"
      >
        ?
      </button>
    );
  }

  return (
    <div
      className="help-panel__backdrop"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="help-panel__dialog"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-labelledby="introduction-title"
      >
        <div className="help-panel__header">
          <h2 id="introduction-title">Introduction</h2>
          <button
            type="button"
            className="help-panel__close"
            onClick={onClose}
            aria-label="Close introduction"
          >
            ×
          </button>
        </div>

        <div className="help-panel__tabs" role="tablist" aria-label="Introduction topics">
          {(Object.keys(TAB_LABELS) as HelpTab[]).map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              id={`help-tab-${tab}`}
              className={`help-panel__tab${activeTab === tab ? " help-panel__tab--active" : ""}`}
              aria-selected={activeTab === tab}
              aria-controls={`help-panel-${tab}`}
              onClick={() => setActiveTab(tab)}
            >
              {TAB_LABELS[tab]}
            </button>
          ))}
        </div>

        <div className="help-panel__body">
          {activeTab === "map" && (
            <ul
              id="help-panel-map"
              className="help-panel__list"
              role="tabpanel"
              aria-labelledby="help-tab-map"
            >
              <li>
                <strong>Filters</strong>: Checkboxes and sliders narrow which
                individuals count toward results. All active filters combine together.
              </li>
              <li>
                <strong>Selection tool</strong>: Use the polygon tool (bottom-left) to
                draw a shape. Click vertices, then close on the first point. Only
                individuals inside the shape are kept.
              </li>
              <li>
                <strong>Map</strong>: Hover for ID. Single-click for measurements.
                Double-click to exclude or re-include (excluded points stay visible but
                greyed out).
              </li>
              <li>
                <strong>Saved filters</strong>: Save your current checkbox, slider, and
                selection-tool settings under a name. Choose one from the list and click
                Load to apply it. Manual double-click exclusions are not saved.
              </li>
            </ul>
          )}

          {activeTab === "field" && (
            <div
              id="help-panel-field"
              className="help-panel__sections"
              role="tabpanel"
              aria-labelledby="help-tab-field"
            >
              <p className="help-panel__intro">
                Note: All measurements are recorded to two decimal places. GPS is
                accurate to 3&nbsp;m.
              </p>
              <section className="help-panel__section">
                <h3>DBH</h3>
                <p>
                  Diameter at Breast Height (DBH) is measured at 1.30&nbsp;m above
                  ground, in centimeters. A blank value means the plant was not tall
                  enough to measure there.
                </p>
              </section>
              <section className="help-panel__section">
                <h3>Base diameter</h3>
                <p>
                  Widest diameter at the base of the plant, in centimeters.
                </p>
              </section>
              <section className="help-panel__section">
                <h3>Height</h3>
                <p>Total height of the plant, in meters.</p>
              </section>
              <section className="help-panel__section">
                <h3>Stem count</h3>
                <p>
                  Number of stems from the base. Recorded as <em>Multiple</em> for some
                  plants when the number of stems is unclear.
                </p>
              </section>
              <section className="help-panel__section">
                <h3>Sex</h3>
                <p>
                  Male and female plants can only be differentiated when flowering in
                  early spring. Female plants may also be recognized in late summer and
                  fall by bright red fruit. Reliable identification requires a plant
                  mature enough to flower or fruit and a survey during the appropriate
                  season.
                </p>
                <ul className="help-panel__bullets">
                  <li>
                    <em>Juvenile</em>: did not flower during flowering season.
                  </li>
                  <li>
                    <em>Unknown</em>: surveyed outside flowering season.
                  </li>
                </ul>
              </section>
            </div>
          )}

          {activeTab === "background" && (
            <div
              id="help-panel-background"
              className="help-panel__sections"
              role="tabpanel"
              aria-labelledby="help-tab-background"
            >
              <section className="help-panel__section">
                <h3>Spicebush</h3>
                <p>
                  <em>Lindera benzoin</em> is a native deciduous shrub of eastern North
                  America. It is known as Northern spicebush, common spicebush, wild
                  allspice, Benjamin bush, and fever bush. In Connecticut it is common
                  in moist woods and along streams.
                </p>
                <figure className="help-panel__figure help-panel__figure--seasons">
                  <div className="help-panel__season-images">
                    <img
                      src={SPICEBUSH_IMAGES.bushSummer}
                      alt="Spicebush in summer with green leaves and red fruit"
                      loading="lazy"
                    />
                    <img
                      src={SPICEBUSH_IMAGES.bushFall}
                      alt="Spicebush in fall with yellow foliage"
                      loading="lazy"
                    />
                  </div>
                  <figcaption>Spicebush in summer and fall.</figcaption>
                </figure>
              </section>
              <section className="help-panel__section">
                <h3>Geographic range</h3>
                <p>
                  Northern spicebush is native to eastern North America, from southern
                  Maine and Ontario west to Iowa and Kansas, and south to Florida and
                  Texas. It is most common in the understory of moist forests, along
                  stream margins, and in other shaded, well-drained sites.
                </p>
                <figure className="help-panel__figure">
                  <img
                    src={SPICEBUSH_IMAGES.rangeMap}
                    alt="Distribution map of Northern spicebush in eastern North America"
                    loading="lazy"
                  />
                  <figcaption>
                    Distribution map. Courtesy of The Ohio State University.
                  </figcaption>
                </figure>
              </section>
              <section className="help-panel__section">
                <h3>Identification</h3>
                <p>
                  Identification is usually done through the bark and leaves. The bark
                  has distinctive white dots (lenticels) on young stems. The leaves are
                  oblong, alternate, and aromatic when crushed, releasing a spicy scent
                  that gives the plant its common name. Small yellow flowers open in early
                  spring before the leaves fully expand. Female plants produce bright red
                  drupes in late summer and fall.
                </p>
                <div className="help-panel__gallery help-panel__gallery--grid">
                  <figure className="help-panel__figure help-panel__figure--crop">
                    <img
                      src={SPICEBUSH_IMAGES.leaves}
                      alt="Alternate oblong spicebush leaves"
                      loading="lazy"
                    />
                    <figcaption>Leaves</figcaption>
                  </figure>
                  <figure className="help-panel__figure help-panel__figure--crop">
                    <img
                      src={SPICEBUSH_IMAGES.bark}
                      alt="Spicebush bark with white lenticels"
                      loading="lazy"
                    />
                    <figcaption>Bark</figcaption>
                  </figure>
                  <figure className="help-panel__figure help-panel__figure--crop">
                    <img
                      src={SPICEBUSH_IMAGES.flowers}
                      alt="Yellow spicebush flowers"
                      loading="lazy"
                    />
                    <figcaption>Flowers</figcaption>
                  </figure>
                  <figure className="help-panel__figure help-panel__figure--crop">
                    <img
                      src={SPICEBUSH_IMAGES.fruit}
                      alt="Red spicebush fruit on branches"
                      loading="lazy"
                    />
                    <figcaption>Fruit</figcaption>
                  </figure>
                </div>
              </section>
              <section className="help-panel__section">
                <h3>Ecology</h3>
                <p>
                  The shrub is an important early-season nectar source and its fruit is
                  eaten by many bird species. It is a larval host plant for the spicebush
                  swallowtail and other butterflies. It belongs to the laurel family
                  (Lauraceae), alongside close relatives such as sassafras (
                  <em>Sassafras albidum</em>), pondberry (<em>Lindera melissifolia</em>
                  ), and southern spicebush (<em>Lindera subcoriacea</em>).
                </p>
              </section>
              <section className="help-panel__section">
                <h3>Further reading</h3>
                <ul className="help-panel__links">
                  <li>
                    <a
                      href="https://www.missouribotanicalgarden.org/PlantFinder/PlantFinderDetails.aspx?kempercode=d890"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Missouri Botanical Garden: <em>Lindera benzoin</em>
                    </a>
                  </li>
                  <li>
                    <a
                      href="https://plants.usda.gov/DocumentLibrary/plantguide/pdf/pg_libe3.pdf"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      USDA plant guide (PDF): <em>Lindera benzoin</em>
                    </a>
                  </li>
                  <li>
                    <a
                      href="https://scholarship.richmond.edu/cgi/viewcontent.cgi?article=1151&context=biology-faculty-publications"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      2006 Wildflower of the Year: Spicebush, <em>Lindera benzoin</em>
                    </a>
                  </li>
                </ul>
              </section>
            </div>
          )}

          {activeTab === "study" && (
            <div
              id="help-panel-study"
              className="help-panel__sections"
              role="tabpanel"
              aria-labelledby="help-tab-study"
            >
              <section className="help-panel__section">
                <h3>Survey data</h3>
                <p>
                  The 74 individuals mapped here were recorded at East Rock Park, New
                  Haven, CT, as a subset of a larger census of 180+ spicebush conducted
                  by the Yale School of the Environment.
                </p>
              </section>
              <section className="help-panel__section">
                <h3>This project</h3>
                <p>
                  We examine{" "}
                  <strong>
                    whether the sex of individual spicebush plants can be predicted using
                    only morphological field measurements
                  </strong>{" "}
                  (DBH, base diameter, stem count, total height) without direct
                  observation of flowers or fruit. The broader goal is to build a model
                  that can predict sex with high confidence outside the narrow
                  flowering/fruiting season, an approach that could extend beyond
                  spicebush to other dioecious species where sex is otherwise difficult
                  to determine most of the year.
                </p>
              </section>
              <section className="help-panel__section">
                <h3>Related work</h3>
                <p>
                  <em>Lindera benzoin</em> is dioecious, meaning individual plants are
                  either male or female. In many dioecious species, females bear a higher
                  reproductive cost than males, since producing flowers and fruit
                  requires more resources than producing pollen, often leading males to
                  allocate more energy toward vegetative growth while females trade
                  growth for reproduction. Prior research on this species supports that
                  pattern in adults: reproductive male spicebush plants show higher
                  growth rates than females (Cipollini &amp; Whigham 1994).
                </p>
                <p>
                  Interestingly, this cost may not appear early in life. A follow-up study
                  found that females may compensate for their later reproductive costs by
                  investing in larger seed size and faster early growth, front-loading
                  resources before flowering begins (Cipollini et al. 2013). This suggests
                  a possible juvenile-to-adult reversal: females comparable or larger in
                  early growth stages, with males pulling ahead once reproduction begins.
                </p>
              </section>
              <section className="help-panel__section">
                <h3>References</h3>
                <ul className="help-panel__refs">
                  <li>
                    Cipollini, M.L. &amp; Whigham, D.F. (1994). Sexual dimorphism and
                    cost of reproduction in the dioecious shrub <em>Lindera benzoin</em>{" "}
                    (Lauraceae). <em>American Journal of Botany</em>, 81(1), 65–75.
                  </li>
                  <li>
                    Cipollini, M.L., Whigham, D.F., &amp; O&apos;Neill, J. (2013). Seed
                    size, sexual dimorphism, and sex ratio in <em>Lindera benzoin</em> L.
                    (Lauraceae). <em>Journal of the Torrey Botanical Society</em>,
                    140(3), 300–313.{" "}
                    <a
                      href="https://www.jstor.org/stable/43287012"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      JSTOR
                    </a>
                  </li>
                  <li>
                    Niesenbaum, R.A. (1992). The effects of light environment on herbivory
                    and growth in the deciduous shrub <em>Lindera benzoin</em> (Lauraceae).{" "}
                    <em>American Midland Naturalist</em>, 128(2), 270–275.{" "}
                    <a
                      href="https://www.jstor.org/stable/2426460"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      JSTOR
                    </a>
                  </li>
                </ul>
              </section>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
