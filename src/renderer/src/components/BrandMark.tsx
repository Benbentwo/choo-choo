import type { SVGProps } from 'react'

/**
 * The Choo Choo locomotive mark from the brand kit (docs/brand). The body uses currentColor so it
 * follows the theme text color; the plow, side stripe and headlight keep the brand orange and amber.
 * Below 64px the simplified "micro" geometry reads better, so small sizes switch to it.
 */
export function BrandMark({ size = 24, ...p }: { size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg width={size} height={size} viewBox="64 76 1020 1020" aria-hidden="true" {...p}>
      {size < 64 ? <Micro /> : <Full />}
    </svg>
  )
}

const Full = () => (
  <>
      <path fill="currentColor" fillRule="evenodd" d="M561 337 C512 310 509 262 545 221 C575 186 623 174 671 192 C676 140 722 104 785 104 C857 104 916 146 922 202 C929 258 890 293 835 294 C801 295 772 281 752 262 C726 264 712 289 713 315 C654 305 601 311 561 337 Z" />
      <path fill="currentColor" fillRule="evenodd" d="M562 371 C561 352 611 336 675 336 C736 336 785 349 786 368 L785 400 Q785 412 777 406 C717 379 630 378 572 411 Q563 416 562 405 Z" />
      <path fill="currentColor" fillRule="evenodd" d="M618 423 Q618 411 681 410 Q751 411 751 423 L750 505 L619 523 Z" />
      <path fill="currentColor" fillRule="evenodd" d="M231 637 Q246 610 264 597 L428 490 Q495 446 578 465 Q586 466 586 472 L586 489 Q586 493 579 491 Q497 481 453 521 L426 548 L239 650 Q219 659 231 637 Z" />
      <path fill="currentColor" fillRule="evenodd" d="M289 655 L328 634 Q331 632 331 637 L331 728 Q331 731 328 733 L290 751 Q286 753 286 747 L286 661 Q286 657 289 655 Z M364 614 L418 584 Q422 582 422 588 L422 685 Q422 689 419 691 L364 717 Q360 720 360 714 L360 620 Q360 616 364 614 Z" />
      <path fill="currentColor" fillRule="evenodd" d="M454 734 L454 674 C451 615 488 577 543 544 L619 498 C659 480 693 486 729 496 C646 496 579 553 557 616 C543 657 545 706 563 743 Q565 747 559 749 L220 858 Q212 862 219 850 Q233 822 259 813 Z" />
      <path fill="currentColor" fillRule="evenodd" d="M580 660 Q577 660 578 654 C583 564 648 496 735 496 C822 496 885 562 892 654 Q893 660 889 660 L865 660 Q861 660 861 655 C854 589 807 543 735 543 C672 543 634 590 626 655 Q626 660 622 660 Z" />
      <path fill="currentColor" fillRule="evenodd" d="M581 681 L622 681 Q626 681 627 686 C636 749 676 794 735 794 C797 794 850 749 860 686 Q861 681 865 681 L888 681 Q893 681 892 687 C884 772 825 838 735 838 C650 838 588 773 579 687 Q578 681 581 681 Z" />
      <path fill="currentColor" fillRule="evenodd" d="M602 817 L893 812 Q900 812 904 819 L1000 960 Q1006 969 997 969 Q994 969 989 964 L897 861 Q892 854 883 854 L576 854 Z" />
      <path fill="#F4773D" fillRule="evenodd" d="M577 854 L859 854 L1017 1046 Q1021 1052 1013 1052 L443 1052 Q435 1052 440 1045 Z M635 854 L545 1007 L621 1007 L670 854 Z M716 854 L701 1007 L776 1007 L749 854 Z M793 854 L857 1007 L925 1007 L824 854 Z" />
      <path fill="#F4773D" fillRule="evenodd" d="M113 909 C231 862 388 832 557 811 Q565 810 558 819 L523 868 Q519 874 512 874 C369 875 229 885 113 909 Z" />
      <circle cx="760" cy="663" r="64" fill="#FFC46B" />
  </>
)

const Micro = () => (
  <>
      <path fill="currentColor" fillRule="evenodd" d="M552 298 C522 250 566 191 626 191 Q653 191 676 201 C691 151 739 124 789 129 C856 133 902 172 902 222 C902 268 865 295 819 295 Q778 295 748 271 Q724 274 714 312 Q626 297 552 327 Z" />
      <path fill="currentColor" fillRule="evenodd" d="M562 371 C561 352 611 336 675 336 C736 336 785 349 786 368 L785 400 Q785 412 777 406 C717 379 630 378 572 411 Q563 416 562 405 Z" />
      <path fill="currentColor" fillRule="evenodd" d="M618 423 Q618 411 681 410 Q751 411 751 423 L750 505 L619 523 Z" />
      <path fill="currentColor" fillRule="evenodd" d="M288 594 L451 492 Q505 461 577 472 L577 515 Q508 503 466 536 L288 650 Z M289 673 L333 648 L333 735 L289 754 Z M375 623 L424 596 L424 706 L375 729 Z M451 758 L451 679 Q451 604 522 559 L637 493 L697 493 Q581 536 557 644 Q547 697 568 750 L258 865 L258 817 Z" />
      <path fill="currentColor" fillRule="evenodd" d="M580 660 Q577 660 578 654 C583 564 648 496 735 496 C822 496 885 562 892 654 Q893 660 889 660 L865 660 Q861 660 861 655 C854 589 807 543 735 543 C672 543 634 590 626 655 Q626 660 622 660 Z" />
      <path fill="currentColor" fillRule="evenodd" d="M581 681 L622 681 Q626 681 627 686 C636 749 676 794 735 794 C797 794 850 749 860 686 Q861 681 865 681 L888 681 Q893 681 892 687 C884 772 825 838 735 838 C650 838 588 773 579 687 Q578 681 581 681 Z" />
      <path fill="currentColor" fillRule="evenodd" d="M602 817 L893 812 Q900 812 904 819 L1000 960 Q1006 969 997 969 Q994 969 989 964 L897 861 Q892 854 883 854 L576 854 Z" />
      <path fill="#F4773D" fillRule="evenodd" d="M593 850 L858 850 L1002 1052 L451 1052 Z M661 850 L589 991 L647 991 L702 850 Z M755 850 L782 991 L846 991 L795 850 Z" />
      <circle cx="760" cy="663" r="68" fill="#FFC46B" />
  </>
)
